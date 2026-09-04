# Implementation status

An honest inventory, current through Sprint 4. "Working" means the full path exists —
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
- Undo/redo over a 100-entry snapshot stack, broadcast to the room and persisted
- Every mutation persisted individually over its own socket event; full rehydration on reload

**Collaboration**
- Socket auth with the same JWT, per-board rooms
- Live cursors with names and per-user colours (throttled to ~25 fps)
- Presence join/leave and an "N online" counter
- Object add / update / delete broadcast and persisted in the same handler

**Version history**
- "Save version" button in the history panel, with a label and the author's name
- An automatic snapshot every 50 object mutations, counted on the server so one board
  produces one timeline no matter how many people are editing
- Restore replaces the board and is broadcast to everyone still in the room
- Pruned to the 50 most recent versions per board

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
| Comment mentions | `mentions[]` on the model, notification fan-out on create | no `@` autocomplete; the panel always posts an empty `mentions` array |
| Comment pinning / threads | `x`, `y`, `parentComment` on the model | panel always posts `x: 0, y: 0` and renders a flat list |
| In-progress stroke streaming | `draw:stream` relay | nothing emits or listens; remote users only see a stroke once it is finished |
| Live text editing | `text:edit` relay | nothing emits or listens |
| Clear canvas | `DELETE /api/canvas/:id/objects` | no button |
| JSON import | `POST /api/canvas/:id/objects/bulk` accepts arbitrary object arrays — now its only caller would be import | export-only menu; no file picker |
| Sync error surfacing | `error:sync` emitted on DB write failure | no listener, so a failed write is silent |
| Board background / grid persistence | `Board.background`, `Board.gridEnabled` | editor hardcodes a white canvas and reads grid state from a client-only store |
| Board privacy | `Board.privacy` enum | never set, never enforced |
| Object locking | `CanvasObject.locked` | never set, never read |
| Board thumbnails | `Board.thumbnail` | never generated; cards show a static gradient |
| `pen`, `marker`, `laser` tools | present in the `ToolType` union (`marker` also has brush sizing) | no toolbar buttons |

## Known gaps & bugs

**Security** — all three fixed in Sprint 1 (see [roadmap.md](roadmap.md))

1. ~~`board:join` performs no membership check.~~ **Fixed.** The hole was wider than
   originally logged: *every* socket handler took `boardId` from the client payload without
   checking it, so `object:add` could write to any board and `draw:stream` could broadcast
   into any room without joining at all. Every handler now checks a role cached at join
   time; mutations require `editor`, `cursor:move` requires `viewer`.
2. ~~Comment resolve/delete skip `requireBoardAccess`.~~ **Fixed** via a new
   `requireCommentAccess(minRole)`, which resolves the comment's board first. Delete now
   returns `403` for a non-author instead of a silent success.
3. ~~`reset-password` does not re-validate password length.~~ **Fixed** — returns `400`.
   Note this path is **not** covered by a test: the invalid-token check runs first, and the
   suite has no way to mint a valid reset token without reading the Ethereal inbox.

**Correctness**
4. ~~**Undo is local-only.**~~ **Fixed in Sprint 3** — undo/redo diff the two history
   snapshots and emit the difference, so they reach both the database and the other people
   on the board. Fixing it turned up three related defects, all also fixed: history
   snapshots carried no `objectId` at all (Fabric 6's `canvas.toJSON()` ignores the
   properties argument — only `toObject(props)` accepts one); the baseline snapshot was
   taken before the board's saved objects had loaded, so it was an empty canvas; and
   snapshots ignored incoming remote changes, so undo could reach back over someone else's
   edit. `object:add` on the server is now an upsert, since undo/redo replays adds.
5. Remote cursors use **viewport** coordinates (`clientX/Y`), not canvas coordinates, so
   they point at the wrong place whenever two people are panned or zoomed differently.
6. ~~`restoreVersion` does not broadcast.~~ **Fixed in Sprint 4** — it emits `board:restored`
   into the board room. Restore was also unscoped: any version id could be restored into any
   board you could write to. It is now looked up as `{ _id, board }`.
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
15. ~~`npm run lint` is defined but eslint is not installed.~~ **Fixed in Sprint 0** —
    flat config in `client/eslint.config.js`; exits 0 with 10 warnings.
16. ~~No tests of any kind.~~ **Partly fixed in Sprint 0** — an 11-test Playwright suite
    covers realtime sync and authorization. Still no unit or API-level tests.
17. `jspdf` is a dependency but is never imported — there is no PDF export.
18. ~~`client/tsconfig.tsbuildinfo` is committed.~~ **Fixed in Sprint 0** — untracked and
    ignored.

## Suggested next steps, roughly in priority order

1. ~~Add a board-access check to `board:join` and the comment resolve/delete routes.~~
   Done in Sprint 1.
2. ~~Actually create versions — call `POST /canvas/:id/versions` on an interval (say every
   Nth auto-save) or from an explicit "Save version" button, so history stops being empty.~~
   Done in Sprint 4. There is no auto-save left to hang it on, so the automatic trigger
   counts object mutations on the server instead.
3. ~~Make undo/redo emit: diff the restored snapshot against the live canvas and emit the
   corresponding `object:add` / `object:delete` / `object:update` events.~~ Done in Sprint 3.
4. Convert cursor coordinates to canvas space before emitting.
5. Build the share dialog on top of the existing invite endpoint, and a notification bell on
   top of the existing notifications endpoint — both are pure frontend work.
6. Add an image tool that posts to `/uploads/image` and drops a `fabric.Image` on the canvas.
7. Emit `object:reorder` from the `[` / `]` shortcuts.
8. Install and configure eslint, or drop the `lint` script.
