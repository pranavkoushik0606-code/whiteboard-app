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
request per keystroke). Each card has a `⋮` menu: favourite, share/people,
rename (inline edit), duplicate, delete (immediate, no confirmation). The menu is gated on
the `role` the list now returns — a viewer sees no rename, a non-owner no delete — rather
than offering an action that comes back 403. Cards show `Board.thumbnail` when there is
one, falling back to a gradient placeholder.

**BoardEditor** — the whole editor:
- `GET /boards/:boardId` for board + objects, opens the socket via `useSocket`
- header with inline-editable title (blur or Enter → `PUT /boards/:id`) and an "N online"
  count driven by `presence:sync|joined|left`
- renders `CanvasBoard`, `PresenceCursors`, `Toolbar`, and the export/comments/history panels
- listens for `board:restored` and reloads the canvas wholesale, skipping the echo of its own
  restore (compares the payload's `by` against the current user id)
- undo/redo buttons work by *dispatching a synthetic `keydown`* (`Ctrl+Z` / `Ctrl+Y`) on
  `window`, which the canvas's own shortcut handler picks up
- reads `role` from the same `GET /boards/:boardId` response and drives the whole
  read-only path from it: the toolbar's `canEdit`, the canvas's `readOnly`, whether the
  title is editable, and a "View only" badge in the header
- listens for `board:role` — an owner demoting you takes effect in place; removing you
  navigates to the dashboard, since the socket has already stopped accepting your writes
  and a reload would 403 at the door

**Settings** — change display name (`PUT /auth/profile`), theme toggle, change password
(`PUT /auth/change-password`), log out.

`useSocket(boardId?)` opens one connection per page. With a board it joins that room and
leaves on unmount; **without** one it still connects, because the server puts every
connection into a `user:<id>` room and the dashboard has no board to join. It also holds a
throwaway `useState` so a caller re-renders once the connection exists — a ref alone cannot
wake anything up, which is what the effects reading `socketRef.current` used to rely on
mount ordering for.

## Components

| Component | Role |
|---|---|
| `Toolbar` | Floating glass bar, bottom-centre: 13 tool buttons, an insert-image button, stroke colour, fill colour, stroke width slider (1–20), undo, redo, grid toggle, comments, history, export, clear canvas. With `canEdit={false}` everything that writes is removed rather than disabled, leaving Select, grid, comments, history and export. Insert-image is not one of the 13 tools: it does not change the mode, it opens a file picker and puts one object on the board |
| `PresenceCursors` | Fixed full-screen overlay (`pointer-events-none`) drawing an SVG arrow + name badge per remote socket, in that user's colour. Cursors travel in scene coordinates and are re-projected through this viewer's own viewport, sampled once per animation frame |
| `CommentsPanel` | Right drawer: loads `GET /comments/:boardId`, appends live via `comment:new`, post box (Enter to send), per-comment resolve toggle. Typing `@` opens an autocomplete over the board roster; mentions are resolved from the text at post time, not accumulated from clicks, so deleting a name back out un-mentions them. Exports `resolveMentions(text, members)`, which is that rule |
| `NotificationBell` | Header bell with an unread badge, a dropdown of the 50 most recent, mark-one-on-open and mark-all-read. Live via `notification:new` on whatever socket the page already has |
| `VersionHistoryPanel` | Right drawer: a name field and Save button that captures a version (the snapshot is built server-side, so nothing but the label is sent), plus a list of versions with label, timestamp, author and a restore button. Restore reloads the canvas locally and is broadcast to the rest of the room as `board:restored` |
| `ExportMenu` | Small popover: PNG / JPEG / PDF / JSON. `jspdf` is dynamically imported so it stays out of the initial bundle |
| `ShareModal` | Invite by email with an editor/viewer dropdown, plus the current roster with per-member role and remove controls. Used from both the dashboard menu and the editor header; a non-owner gets the same roster read-only |
| `ProtectedRoute` | Waits on `loading`, then redirects to `/login` if there's no user |

## The canvas engine — `canvas/CanvasBoard.tsx`

A `forwardRef` component exposing `{ getCanvas(), loadObjects(objects), addImage(file, at?) }`
via `useImperativeHandle`. Internally a set of focused `useEffect` blocks:

0. **Read-only** — when `readOnly` is set, every object is made `selectable: false,
   evented: false`, the active selection is discarded, and the shape, click-placement and
   shortcut handlers all bail out. This is what makes the role gate real: Fabric's controls
   are per-object, so hiding the toolbar would still leave a viewer able to drag, resize and
   rotate anything on the board — writes the server drops in silence, so the change would
   look like it worked and then vanish on reload. Applied as its own effect so an owner
   changing your role mid-session takes hold without a reload.
1. **Init** — creates the `fabric.Canvas` sized to `window.innerWidth × innerHeight-64`,
   `preserveObjectStacking: true`, enlivens `initialObjects`, seeds the history stack, and
   wires a `resize` listener. Disposes on unmount.
2. **Grid & theme** — toggles a CSS `linear-gradient` background (24 px squares) on the canvas
   element, and repaints the Fabric background colour when the theme changes. The canvas is a
   bitmap, so a `dark` class on `<html>` never reaches it. The theme swap also flips the
   default stroke colour (`#1e1e1e` ↔ `#f5f5f5`) — but only while it is still the default, so
   a colour the user picked is left alone.
3. **Brush** — sets `isDrawingMode` for `pencil|pen|highlighter|marker` and builds a
   `PencilBrush`; highlighter is 6× width, marker 3×. The highlighter's brush colour is the
   stroke colour at 40% alpha (`rgba(...)`), because Fabric 6's `PencilBrush` has no
   `opacity` — setting one, as this did until Sprint 6, is a silent no-op. Putting the alpha
   in the colour also means it serializes and persists for free.
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
10. **Paste & drop** — a `paste` listener on the window (the canvas is a bitmap and never
    holds focus) and `dragover`/`drop` on the container. Both filter for a supported image
    and hand it to `addImage`; both bail out for a viewer. The paste listener steps aside
    while a `Textbox` is being edited, where the paste belongs to the text. `dragover` has
    to `preventDefault`, or dropping a PNG on the board navigates the tab to the PNG.

`addImage(file, at?)` is the single path behind the toolbar picker, a paste and a drop, so
all three agree on what is accepted, how it is scaled and where it lands. `at` is a **scene**
point — a drop has to land where it was dropped, not where the dropper happened to be panned
to. Without one (the picker, a paste) the image is centred in the current viewport.

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

## Images — `canvas/images.ts`

Kept out of `CanvasBoard` because the upload, the size rules and the transfer parsing are
all testable on their own.

| Export | What it is |
|---|---|
| `uploadImage(file)` | `POST /uploads/image`, returning the absolute URL to place. Resolves the response's relative `path` against the client's own API origin rather than trusting the absolute `url` the server built from a client-supplied `Host` header |
| `createImage(url, at)` | A `FabricImage` centred on `at`, scaled down so its longest edge is at most 480 px — never up, so a 32 px icon arrives 32 px |
| `imageFromTransfer(dt)` | The first supported image in a paste or a drop. Checks `files` *and* `items`: a dragged file appears in `files`, while a screenshot pasted from the system clipboard is an `item` of kind `file` and may not appear in `files` at all |
| `transferHasFiles(dt)` | The only thing readable during `dragover` |
| `viewportCentre(canvas)` | The centre of what the viewer is looking at, in scene coordinates |

**`crossOrigin: 'anonymous'` is the load-bearing line here.** Uploads are served from the
API origin, which is never the client's. Drawing a cross-origin image without CORS *taints*
the canvas, and every `toDataURL` after it throws a `SecurityError` — which is all that PNG,
JPEG and PDF export and the dashboard thumbnail are. One image would have silently killed
all four, permanently, on any board that ever held one. Fabric serializes `crossOrigin`
alongside `src` and passes it back to `loadImage`, so it survives the trip to other clients;
the server's side of the bargain is the `Access-Control-Allow-Origin` that `cors()` already
puts on `/uploads`.

**Exported helpers**:
- `toScenePoint(canvas, event)` / `toViewportPoint(vpt, point)` — screen ↔ scene conversion,
  used by `PresenceCursors` in both directions. Written in the general matrix form
  (`invertTransform` + `transformPoint`) rather than `(x - vpt[4]) / vpt[0]`, so they stay
  correct if the viewport ever picks up a rotation
- `thumbnailDataUrl` — a ≤240 px JPEG cropped to the objects' bounding box. `toDataURL`'s crop
  is in **screen** pixels, so the viewport is flattened to identity first and restored after;
  without that, a board left scrolled into an empty corner photographs the empty corner. Called
  from the canvas teardown, and skipped before hydration finishes so StrictMode's throwaway
  first mount cannot blank a good thumbnail
- `exportPNG` / `exportJPEG` — `toDataURL` at `multiplier: 2` (JPEG at quality 0.9),
  triggered via a synthetic `<a download>`
- `exportPDF` — `jspdf` at page size = canvas size, imported dynamically
- `TAINTED_CANVAS_MESSAGE` — every read of the canvas pixels goes through one internal
  `readPixels` helper that catches the `SecurityError` a tainted canvas throws. Our own
  images cannot cause it, but a board holds objects other people put there, and one image
  from somewhere else should not take export down with it. The exporters throw this message,
  which `BoardEditor` shows as a line of text; `thumbnailDataUrl` returns `''`, which its
  caller already skips
- `exportJSON` — pretty-printed canvas JSON as a Blob download

Helper factories `makeStickyNote(x, y)` and `makeStar(...)` (5-spike polygon, outer radius
40 / inner 18) live at the bottom of the same file.

## Styling

Tailwind with `darkMode: 'class'`, a custom `primary` indigo ramp (50/100/500/600/700), and
enlarged `xl`/`2xl` radii. `index.css` adds a `.glass` utility (12 px backdrop blur over a
translucent white / near-black surface) used by every floating bar and drawer, plus thin
custom scrollbars.

`framer-motion` is used only for the entrance animation on the Login and Signup cards.
