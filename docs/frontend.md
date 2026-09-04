# Frontend

## Boot sequence

`main.tsx` renders `<StrictMode><BrowserRouter><ThemeProvider><App/>`. `App` calls
`useAuthStore.hydrate()` once on mount: if a token is in `localStorage`, it calls
`GET /auth/me` to restore the session; on failure it clears the token. Until that resolves,
`loading` is `true` and `ProtectedRoute` renders a "Loading…" screen instead of bouncing
you to `/login` — that's what makes login persist across refreshes.

## Routes (`App.tsx`)

| Path | Component | Guard |
|---|---|---|
| `/login` | `Login` | public |
| `/signup` | `Signup` | public |
| `/forgot-password` | `ForgotPassword` | public |
| `/reset-password/:token` | `ResetPassword` | public |
| `/dashboard` | `Dashboard` | `ProtectedRoute` |
| `/board/:boardId` | `BoardEditor` | `ProtectedRoute` |
| `/settings` | `Settings` | `ProtectedRoute` |
| `/` and `*` | → redirect to `/dashboard` | |

## State

| Store | Holds | Notes |
|---|---|---|
| `useAuthStore` | `user`, `token`, `loading`, `login`, `signup`, `logout`, `hydrate` | Token mirrored into `localStorage`; that's the single source of truth for the axios interceptor and the socket handshake |
| `useBoardStore` | `owned`, `shared`, `loading`, `fetchBoards`, `createBoard`, `renameBoard`, `deleteBoard`, `duplicateBoard`, `toggleFavorite` | Optimistically patches the local list after each mutation |
| `useCanvasStore` | `tool`, `strokeColor`, `fillColor`, `strokeWidth`, `gridVisible` + setters | Pure UI state, never persisted |
| `ThemeContext` | `theme`, `toggleTheme` | Persisted to `localStorage.theme`, toggles `.dark` on `<html>` for Tailwind's class dark mode. Independent of `User.theme` on the server |

`ToolType` = `select | pencil | pen | highlighter | marker | eraser | laser | rectangle |
circle | triangle | diamond | star | arrow | line | text | sticky-note`. The toolbar exposes
13 of these; `pen`, `marker` and `laser` are in the type union but have no button.

## `lib/api.ts`

Axios instance on `VITE_API_URL`. Request interceptor injects
`Authorization: Bearer <localStorage.token>`. Response interceptor: on `401`, drops the
token and hard-navigates to `/login` (unless already there).

## Pages

**Login / Signup** — form → `authStore.login/signup` → navigate to `/dashboard`; server
error message shown inline. **ForgotPassword** — posts the email, then renders the returned
`devPreviewUrl` as a clickable link so the Ethereal test mail can be opened directly.
**ResetPassword** — reads `:token` from the URL, posts the new password, redirects to login.

**Dashboard** — header (theme toggle, settings, colour-coded avatar) and a control row:
"New board", search box, filter pills (`all | recent | favorite | shared`), grid/list
toggle. `fetchBoards` re-runs whenever `search` or `filter` changes (no debounce — one
request per keystroke). Each card has a `⋮` menu: favourite, rename (inline edit),
duplicate, delete (immediate, no confirmation). Card thumbnails are a static gradient —
`Board.thumbnail` is never generated.

**BoardEditor** — the whole editor:
- `GET /boards/:boardId` for board + objects, opens the socket via `useSocket`
- header with inline-editable title (blur or Enter → `PUT /boards/:id`) and an "N online"
  count driven by `presence:sync|joined|left`
- renders `CanvasBoard`, `PresenceCursors`, `Toolbar`, and the export/comments/history panels
- listens for `board:restored` and reloads the canvas wholesale, skipping the echo of its own
  restore (compares the payload's `by` against the current user id)
- undo/redo buttons work by *dispatching a synthetic `keydown`* (`Ctrl+Z` / `Ctrl+Y`) on
  `window`, which the canvas's own shortcut handler picks up

**Settings** — change display name (`PUT /auth/profile`), theme toggle, change password
(`PUT /auth/change-password`), log out.

## Components

| Component | Role |
|---|---|
| `Toolbar` | Floating glass bar, bottom-centre: 13 tool buttons, stroke colour, fill colour, stroke width slider (1–20), undo, redo, grid toggle, comments, history, export |
| `PresenceCursors` | Fixed full-screen overlay (`pointer-events-none`) drawing an SVG arrow + name badge per remote socket, in that user's colour |
| `CommentsPanel` | Right drawer: loads `GET /comments/:boardId`, appends live via `comment:new`, post box (Enter to send), per-comment resolve toggle |
| `VersionHistoryPanel` | Right drawer: a name field and Save button that captures a version (the snapshot is built server-side, so nothing but the label is sent), plus a list of versions with label, timestamp, author and a restore button. Restore reloads the canvas locally and is broadcast to the rest of the room as `board:restored` |
| `ExportMenu` | Small popover: PNG / JPEG / JSON |
| `ProtectedRoute` | Waits on `loading`, then redirects to `/login` if there's no user |

## The canvas engine — `canvas/CanvasBoard.tsx`

A `forwardRef` component exposing `{ getCanvas(), loadObjects(objects) }` via
`useImperativeHandle`. Internally a set of focused `useEffect` blocks:

1. **Init** — creates the `fabric.Canvas` sized to `window.innerWidth × innerHeight-64`,
   `preserveObjectStacking: true`, enlivens `initialObjects`, seeds the history stack, and
   wires a `resize` listener. Disposes on unmount.
2. **Grid** — toggles a CSS `linear-gradient` background (24 px squares) on the canvas element.
3. **Brush** — sets `isDrawingMode` for `pencil|pen|highlighter|marker` and builds a
   `PencilBrush`; highlighter is 6× width, marker 3×.
4. **Shape drawing** — `mouse:down` creates the shape at the pointer, `mouse:move` resizes
   it (lines update `x2/y2`, circles use radius, everything else width/height with negative-
   drag origin correction), `mouse:up` emits `object:add` and pushes history.
5. **Click placement** — for `text` (a `Textbox` seeded "Double-click to edit"),
   `sticky-note` (a `Group` of a rounded yellow `Rect` + `Textbox`, with a drop shadow), and
   `eraser` (hit-test via `findTarget`, then delete + emit). Text and sticky note snap the
   tool back to `select` after placing.
6. **Local edits** — `path:created` (free-draw finished) → tag + emit add; `object:modified`
   → emit update. Both push history, both skip while `isRemoteUpdate` is set.
7. **Remote edits** — applies `object:added|updated|deleted` from the socket.
8. **Zoom & pan** — wheel zooms about the pointer, clamped to 0.2×–5×; hold **Space** and
   drag to pan by mutating `viewportTransform[4]/[5]`.
9. **Shortcuts** — `Delete`/`Backspace` (multi-select aware, ignored while editing text),
   `Ctrl+Z` undo, `Ctrl+Y` / `Ctrl+Shift+Z` redo, `Ctrl+D` duplicate at +20/+20 offset,
   `]` bring to front, `[` send to back.

**History** is a snapshot stack: every mutation pushes `serializeCanvas(canvas)` —
`canvas.toObject(['objectId', 'zIndex'])` — truncating any redo tail, capped at 100 entries.
The baseline snapshot is taken *after* the board's saved objects finish loading, so it
describes the board as you found it rather than an empty canvas.

Undo/redo `loadFromJSON` the neighbouring entry **and broadcast the difference**: the two
snapshots are diffed by `objectId` and the result emitted as `object:add` / `object:update` /
`object:delete` / `object:reorder`. Undo therefore reaches the database and the other people
on the board, which it never did before Sprint 3.

Two supporting rules make that safe:
- Every incoming remote event **rebases the whole stack** (`rebaseHistory`), so a snapshot
  that predates someone else's edit can't reach back and undo their work.
- Custom props must be named in every serialization call. Fabric 6's `canvas.toJSON()`
  takes **no arguments** — only `toObject(props)` does — so the old
  `canvas.toJSON(['objectId'])` produced anonymous snapshots. Anything that serializes the
  canvas goes through `serializeCanvas` now.

**Exported helpers** (used by `BoardEditor`):
- `exportPNG` / `exportJPEG` — `toDataURL` at `multiplier: 2` (JPEG at quality 0.9),
  triggered via a synthetic `<a download>`
- `exportJSON` — pretty-printed canvas JSON as a Blob download

Helper factories `makeStickyNote(x, y)` and `makeStar(...)` (5-spike polygon, outer radius
40 / inner 18) live at the bottom of the same file.

## Styling

Tailwind with `darkMode: 'class'`, a custom `primary` indigo ramp (50/100/500/600/700), and
enlarged `xl`/`2xl` radii. `index.css` adds a `.glass` utility (12 px backdrop blur over a
translucent white / near-black surface) used by every floating bar and drawer, plus thin
custom scrollbars.

`framer-motion` is used only for the entrance animation on the Login and Signup cards.
`jspdf` is installed but not imported anywhere — PDF export is not implemented.
