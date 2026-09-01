# Implementation status

An honest inventory as of commit `92ceeea`. "Working" means the full path exists —
UI → API/socket → database — not just that a schema field or endpoint is present.

## Working end to end

**Auth & account**
- Signup, login, JWT issue/verify, bcrypt hashing
- Persistent login (token in `localStorage`, `hydrate()` → `GET /auth/me` on boot)
- Protected routes with a loading gate; global `401` → logout + redirect
- Forgot password → Ethereal email → reset link → set new password → new JWT
- Change password, change display name

**Dashboard**
- Create, open, rename (inline), duplicate, delete boards
- Favourite toggle, title search, `all / recent / favorite / shared` filters, grid/list views
- Boards sorted by `lastOpenedAt`, bumped every time a board is opened

**Canvas**
- Infinite canvas, wheel zoom (0.2×–5×, about the pointer), Space+drag pan
- Free draw: pencil, highlighter (6× width), marker (3× width); eraser by click hit-test
- Shapes: rectangle, circle, triangle, diamond, star, line, arrow
- Text boxes and sticky notes (click to place)
- Move / resize / rotate / multi-select via Fabric controls
- Shortcuts: `Delete`, `Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z`, `Ctrl+D`, `[`, `]`
- Grid toggle, stroke colour, fill colour, stroke width (1–20)
- Undo/redo over a 100-entry local snapshot stack
- Auto-save every 10 s via bulk upsert; full rehydration on reload

**Collaboration**
- Socket auth with the same JWT, per-board rooms
- Live cursors with names and per-user colours (throttled to ~25 fps)
- Presence join/leave and an "N online" counter
- Object add / update / delete broadcast and persisted in the same handler

**Comments**
- List, post, live append to everyone in the room, resolve/unresolve toggle

**Export**
- PNG and JPEG at 2× via `toDataURL`, plus raw canvas JSON download

**Other**
- Dark/light mode across the app, persisted to `localStorage`
- Helmet, CORS, rate limiting, mongo sanitization, centralised error handling
- Docker Compose for local, `render.yaml` + `vercel.json` for deploy

## Built on the backend, no UI yet

These endpoints/events are implemented and reachable, but **nothing in the client calls them**:

| Capability | Backend | Missing piece |
|---|---|---|
| Image upload | `POST /api/uploads/image` (Multer, 10 MB, image MIME allowlist) + static `/uploads` | no image tool in the toolbar, no upload control |
| Board sharing / invites | `POST /api/boards/:id/invite`, full `BoardMember` role model, `requireBoardAccess` | no share dialog; the `shared` dashboard filter can only ever show boards someone added you to via a direct API call |
| Notifications | `GET /api/notifications`, `PUT /:id/read`; rows written on invite and on mention | no bell/inbox UI |
| Version snapshots | `POST /api/canvas/:id/versions` (+50-version pruning) | **never called** — so the history panel is always empty and restore has nothing to restore. This is the biggest single gap |
| Comment mentions | `mentions[]` on the model, notification fan-out on create | no `@` autocomplete; the panel always posts an empty `mentions` array |
| Comment pinning / threads | `x`, `y`, `parentComment` on the model | panel always posts `x: 0, y: 0` and renders a flat list |
| Object z-order sync | `object:reorder` → `object:reordered` | `[` / `]` change the local stacking order but never emit |
| In-progress stroke streaming | `draw:stream` relay | nothing emits or listens; remote users only see a stroke once it is finished |
| Live text editing | `text:edit` relay | nothing emits or listens |
| Clear canvas | `DELETE /api/canvas/:id/objects` | no button |
| JSON import | `POST /api/canvas/:id/objects/bulk` accepts arbitrary object arrays | export-only menu; no file picker |
| Sync error surfacing | `error:sync` emitted on DB write failure | no listener, so a failed write is silent |
| Board background / grid persistence | `Board.background`, `Board.gridEnabled` | editor hardcodes a white canvas and reads grid state from a client-only store |
| Board privacy | `Board.privacy` enum | never set, never enforced |
| Object locking | `CanvasObject.locked` | never set, never read |
| Board thumbnails | `Board.thumbnail` | never generated; cards show a static gradient |
| `pen`, `marker`, `laser` tools | present in the `ToolType` union (`marker` also has brush sizing) | no toolbar buttons |

## Known gaps & bugs

**Security**
1. `board:join` performs **no membership check** — any authenticated user who knows a board
   id can join its room and receive/send every canvas mutation. The REST layer is guarded;
   the socket layer is not. This is the most important one to fix.
2. `PUT /api/comments/comment/:id/resolve` and `DELETE /api/comments/comment/:id` skip
   `requireBoardAccess` — any logged-in user can resolve any comment by id. (Delete is at
   least scoped to `author: req.user._id`.)
3. `POST /api/auth/reset-password/:token` does not re-validate password length, so the
   6-character minimum is only enforced by Mongoose on save, and surfaces as a generic 500
   rather than a 400.

**Correctness**
4. **Undo is local-only.** It neither emits socket events nor deletes from the database, and
   the 10-second bulk auto-save only upserts — it never deletes. So undoing an object's
   creation removes it from your screen but leaves it in Mongo: it reappears for you on
   reload and never disappears for anyone else.
5. Remote cursors use **viewport** coordinates (`clientX/Y`), not canvas coordinates, so
   they point at the wrong place whenever two people are panned or zoomed differently.
6. `restoreVersion` does not broadcast — other people in the room keep the old canvas until
   they reload, and their next auto-save can re-upsert the objects you just restored away.
7. Highlighter transparency does not apply: the code sets `opacity` on a Fabric 6
   `PencilBrush`, which has no such property. Highlighter is just a wider opaque stroke.
8. `Board.isFavorite` is a property of the board, not of the (user, board) pair — once board
   sharing gets a UI, one member favouriting a board favourites it for everyone.
9. `GET /api/boards` has no pagination, and `filter=recent` only truncates the *shared* list,
   so "recent" and "all" look identical for boards you own.
10. Dashboard search fires a request per keystroke — no debounce.
11. `BoardEditor`'s presence effect lists `socketRef.current` in its dependency array; a ref
    mutation does not re-run an effect, so this silently relies on mount ordering. Likewise
    `CanvasBoard` receives the socket as a prop read from a ref, so a reconnect would not
    re-bind its listeners.
12. Presence is a per-process in-memory `Map` — correct on one instance, wrong the moment
    the backend is scaled horizontally (needs the socket.io Redis adapter).
13. Two users dragging the same object simply overwrite each other (last write wins). No OT,
    no CRDT, no locking.
14. Uploaded files live on the container filesystem; on Render's free tier they vanish on
    every restart.

**Tooling**
15. `npm run lint` in `client/` is defined but **eslint is not installed and there is no
    config**, so the script fails.
16. No tests of any kind.
17. `jspdf` is a dependency but is never imported — there is no PDF export.
18. `client/tsconfig.tsbuildinfo` is committed; it is a build artefact and should be
    gitignored.

## Suggested next steps, roughly in priority order

1. Add a board-access check to `board:join` (reuse the `roleRank` logic from
   `boardAccess.js`) and to the comment resolve/delete routes.
2. Actually create versions — call `POST /canvas/:id/versions` on an interval (say every
   Nth auto-save) or from an explicit "Save version" button, so history stops being empty.
3. Make undo/redo emit: diff the restored snapshot against the live canvas and emit the
   corresponding `object:add` / `object:delete` / `object:update` events.
4. Convert cursor coordinates to canvas space before emitting.
5. Build the share dialog on top of the existing invite endpoint, and a notification bell on
   top of the existing notifications endpoint — both are pure frontend work.
6. Add an image tool that posts to `/uploads/image` and drops a `fabric.Image` on the canvas.
7. Emit `object:reorder` from the `[` / `]` shortcuts.
8. Install and configure eslint, or drop the `lint` script.
