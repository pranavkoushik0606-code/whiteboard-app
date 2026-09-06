# Implementation status

An honest inventory, current through Sprint 9. "Working" means the full path exists —
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
- Favourite toggle (per user, and works on a board shared with you), title search,
  `all / recent / favorite / shared` filters, grid/list views
- Card menu gated on your role: no rename for a viewer, no delete for a non-owner
- Boards sorted by `lastOpenedAt`, bumped every time a board is opened

**Canvas**
- Infinite canvas, wheel zoom (0.2×–5×, about the pointer), Space+drag pan
- Free draw: pencil, highlighter (6× width at 40% alpha), marker (3× width); eraser by
  click hit-test
- Shapes: rectangle, circle, triangle, diamond, star, line, arrow
- Text boxes and sticky notes (click to place)
- Move / resize / rotate / multi-select via Fabric controls
- Shortcuts: `Delete`, `Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z`, `Ctrl+D`, `[`, `]`
- Grid toggle, stroke colour, fill colour, stroke width (1–20)
- Canvas background and grid follow the theme; the default stroke flips with it so the pen
  stays visible
- Clear-canvas button behind an in-page confirmation, broadcast to the room
- Undo/redo over a 100-entry snapshot stack, broadcast to the room and persisted
- Every mutation persisted individually over its own socket event; full rehydration on reload

**Sharing**
- Share modal: invite by email with an editor/viewer role, see the current roster, change
  a member's role, remove a member. Reachable from the dashboard card menu and the editor
- Viewers get a genuinely read-only board — no write tools, and every object made inert,
  because Fabric's controls are per-object and a hidden toolbar does not disarm them
- A role change or removal reaches sockets already in the board, rather than waiting for
  the member to reconnect
- `owner` is not a grantable role, and the board's own owner cannot be added as a member

**Collaboration**
- Socket auth with the same JWT, per-board rooms
- Live cursors with names and per-user colours (throttled to ~25 fps), sent in scene
  coordinates so they point at the same thing however each person is panned or zoomed
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
- `@` autocomplete over the board roster; mentions are highlighted in the posted text and
  fan out as notifications

**Images**
- Insert from the toolbar, paste from the clipboard, or drag and drop onto the board
- Scaled down to a 480 px longest edge; a drop lands at the drop point in scene coordinates
- Loaded with CORS so the canvas stays exportable, and served with the headers that makes
  possible

**Notifications**
- Header bell with an unread badge, on the dashboard and in the editor
- Delivered live over a per-user socket room, so an invite lands without a reload
- Mark one read by opening it (which navigates to the board), or mark all read
- Rows are removed with their board, and when a member is removed from a board

**Export**
- PNG and JPEG at 2× via `toDataURL`, PDF via `jspdf` (loaded on demand), plus raw canvas
  JSON download
- Board thumbnails captured on the way out, cropped to the objects, shown on dashboard cards

**Other**
- Dark/light mode across the app, persisted to `localStorage`
- Helmet, CORS, rate limiting, mongo sanitization, centralised error handling
- Docker Compose for local, `render.yaml` + `vercel.json` for deploy

## Built on the backend, no UI yet

These endpoints/events are implemented and reachable, but **nothing in the client calls them**:

| Capability | Backend | Missing piece |
|---|---|---|
| Comment pinning / threads | `x`, `y`, `parentComment` on the model | panel always posts `x: 0, y: 0` and renders a flat list |
| In-progress stroke streaming | `draw:stream` relay | nothing emits or listens; remote users only see a stroke once it is finished |
| Live text editing | `text:edit` relay | nothing emits or listens |
| JSON import | `POST /api/canvas/:id/objects/bulk` accepts arbitrary object arrays — now its only caller would be import | export-only menu; no file picker |
| Sync error surfacing | `error:sync` emitted on DB write failure | no listener, so a failed write is silent |
| Board background / grid persistence | `Board.background`, `Board.gridEnabled` | editor hardcodes a white canvas and reads grid state from a client-only store |
| Board privacy | `Board.privacy` enum | never set, never enforced |
| Object locking | `CanvasObject.locked` | never set, never read |
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
5. ~~Remote cursors use **viewport** coordinates (`clientX/Y`), not canvas coordinates.~~
   **Fixed in Sprint 6** — `cursor:move` now carries scene coordinates, and the receiver
   re-projects them through its own viewport. That second half matters as much as the
   first: a cursor is pinned to a point on the *board*, so it has to move when the
   **viewer** pans, not only when the sender does.
6. ~~`restoreVersion` does not broadcast.~~ **Fixed in Sprint 4** — it emits `board:restored`
   into the board room. Restore was also unscoped: any version id could be restored into any
   board you could write to. It is now looked up as `{ _id, board }`.
7. ~~Highlighter transparency does not apply.~~ **Fixed in Sprint 6** — the alpha moved
   into the brush colour (`rgba(…, 0.4)`), since Fabric 6's `PencilBrush` has no `opacity`
   property and assigning one was a silent no-op. Keeping it in the colour also means it
   serializes and persists without any extra plumbing.
8. ~~`Board.isFavorite` is a property of the board, not of the (user, board) pair.~~
   **Fixed in Sprint 7** — moved to a `Favorite` collection keyed on (user, board), with a
   `PUT /boards/:id/favorite` route that needs only `viewer`, since a bookmark is not a
   write to the board. Existing flags are migrated on boot by
   `services/favoriteMigration.js`; because nobody could share a board while the flag lived
   there, the owner was the only person who ever set it, which makes the migration exact
   rather than a guess. That migration is verified by a one-off script, **not** by the
   regression suite — it runs at boot, and the suite starts the server once, before any
   test could seed a legacy board.
9. `GET /api/boards` has no pagination, and `filter=recent` only truncates the *shared* list,
   so "recent" and "all" look identical for boards you own.
10. Dashboard search fires a request per keystroke — no debounce.
10a. A membership row written before Sprint 7 could carry `role: 'owner'` or a junk string,
    because the update ran with no validators. `getBoardRole` still reads them: an `owner`
    row grants full ownership, and a junk role grants nothing. New rows cannot be either,
    but no backfill was run.
11. `BoardEditor`'s presence effect lists `socketRef.current` in its dependency array; a ref
    mutation does not re-run an effect, so this silently relies on mount ordering. Likewise
    `CanvasBoard` receives the socket as a prop read from a ref, so a reconnect would not
    re-bind its listeners.
12. Presence is a per-process in-memory `Map` — correct on one instance, wrong the moment
    the backend is scaled horizontally (needs the socket.io Redis adapter).
12a. ~~Posting a comment never reached anyone else.~~ **Fixed in Sprint 8** — the client
    emitted the bare comment object while the socket handler destructures
    `{ boardId, comment }`, so `boardId` was `undefined`, the authorization check failed,
    and the broadcast was dropped. The `comment:new` listener on the other end had been
    correct the whole time and simply never fired.
13. Two users dragging the same object simply overwrite each other (last write wins). No OT,
    no CRDT, no locking.
14. Uploaded files live on the container filesystem; on Render's free tier they vanish on
    every restart.

**Tooling**
15. ~~`npm run lint` is defined but eslint is not installed.~~ **Fixed in Sprint 0** —
    flat config in `client/eslint.config.js`; exits 0 with 10 warnings.
16. ~~No tests of any kind.~~ **Partly fixed in Sprint 0** — an 11-test Playwright suite
    covers realtime sync and authorization. Still no unit or API-level tests.
17. ~~`jspdf` is a dependency but is never imported.~~ **Fixed in Sprint 5.**
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
4. ~~Convert cursor coordinates to canvas space before emitting.~~ Done in Sprint 6.
5. ~~Build the share dialog on top of the existing invite endpoint, and a notification bell
   on top of the existing notifications endpoint.~~ Done in Sprints 7 and 8. Neither turned
   out to be "pure frontend": reading a field for the first time is what tells you nothing
   was ever validating it.
6. ~~Add an image tool that posts to `/uploads/image` and drops a `fabric.Image` on the
   canvas.~~ Done in Sprint 9. The endpoint had been sitting there unused since the first
   commit, and calling it for the first time is what surfaced the stored-XSS extension bug
   and the two `500`s.
6a. **Shape and text placement still uses viewport coordinates, not scene coordinates.**
   `mouse:down` in the shape and click-placement effects reads `canvas.getViewportPoint(e)`
   and assigns the result straight to `left`/`top`, which are scene coordinates. On an
   unpanned, unzoomed board the two are equal, which is why this has never been visible.
   Pan or zoom first and a shape lands somewhere other than where you clicked. Sprint 6
   fixed exactly this class of bug for cursors and Sprint 9 avoided it for image drops
   (`toScenePoint`); the shape tools were not in scope for either. The fix is
   `canvas.getScenePoint(e)` — safe here, unlike in an independent window listener, because
   these run inside Fabric's own event handling.
6b. **Uploads are authenticated but not board-scoped.** `POST /uploads/image` takes a JWT
   and nothing else, so any signed-in user can fill the disk, and a viewer can upload a file
   they are not allowed to place. Nothing is ever deleted either — removing an image from a
   board leaves the file. Worth solving together with moving off the container filesystem
   (see setup-and-deployment), not before.
7. Emit `object:reorder` from the `[` / `]` shortcuts.
8. Install and configure eslint, or drop the `lint` script.
