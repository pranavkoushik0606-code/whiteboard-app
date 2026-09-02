# Roadmap

The improvement work from `implementation-status.md`, cut into sprints small enough to
finish and ship in one sitting. Every sprint is independently shippable — nothing here
leaves the app in a half-migrated state at the end of a sprint.

Estimates are implementation time, not calendar time. They assume MongoDB is running
locally and you review as you go.

**Total: ~24 hours** — a core track of ~12 h, a Yjs fork of ~4 h, and ~8 h of optional
feature work.

---

## Core track

Do these in order. Each depends on the ones above it.

### Sprint 0 — Safety net · 75 min

Nothing else in this list is safe to do without a way to see collaboration break.

- Playwright, two browser contexts: open the same board, draw in one, assert the object
  appears in the other — 60 min
- `.gitignore` `client/tsconfig.tsbuildinfo`; install eslint + a config, or drop the
  dead `lint` script — 15 min

*Every later sprint touches the sync path. Without this you re-test by hand each time.*

### Sprint 1 — Close the security holes · 45 min

- Guard `board:join` — reuse the `roleRank` check from `middleware/boardAccess.js` — 25 min
- Add `requireBoardAccess` to `PUT /comments/comment/:id/resolve` and `DELETE
  /comments/comment/:id` — 10 min
- Re-validate password length in `POST /auth/reset-password/:token` so it 400s instead
  of 500s — 10 min

*No UI change. Ships on its own.*

### Sprint 2 — Stop the write amplification · 35 min

- Delete the 10-second bulk auto-save interval in `BoardEditor.tsx`
- The socket path becomes the only writer; keep `POST /objects/bulk` for JSON import only

*With 5 people on a 500-object board the old interval was ~250 object-writes/second of
pure duplication. Sprint 0's test is what tells you nothing regressed.*

### Sprint 3 — Make undo honest · 50 min

- Diff the restored history snapshot against the live canvas, emit the corresponding
  `object:add` / `object:delete` / `object:update`

*Fixes the resurrect bug: today undo removes an object from your screen but leaves it in
Mongo. Must come after Sprint 2 — while the bulk upsert still runs it fights the diff.*
**Skip this sprint if you know you're doing Yjs** — `Y.UndoManager` replaces it wholesale.

### Sprint 4 — Version history stops being a lie · 40 min

- Call `POST /canvas/:id/versions` from an explicit "Save version" button and every Nth
  auto-save
- Broadcast on `restoreVersion` so other people in the room don't keep the old canvas

*The endpoint and its 50-version pruning already exist and have never once been called.*

### Sprint 5 — Cheap visible wins · 60 min

The first sprint you can actually see.

- Board thumbnails: `toDataURL({ multiplier: 0.1 })` on unmount → `Board.thumbnail` — 25 min
- PDF export — `jspdf` is already a dependency and has never been imported — 15 min
- Clear-canvas button on the existing `DELETE /canvas/:id/objects`, with a confirm — 10 min
- Dark-mode canvas background (currently hardcoded white) — 10 min

### Sprint 6 — Pointing at the right things · 30 min

- Convert cursor coordinates to canvas space before emitting — today they're `clientX/Y`,
  so remote cursors point at the wrong place whenever two people are panned differently
- Fix the highlighter: set an alpha colour, not `brush.opacity` — Fabric 6's `PencilBrush`
  has no such property, so highlighter is currently just a wider opaque stroke

*Do a minimal version of this if you're heading for Yjs — awareness replaces the cursor half.*

### Sprint 7 — Sharing UI · 55 min

- Share modal on the existing `POST /boards/:id/invite` + `BoardMember` role model — 30 min
- Role-gate the toolbar off the `req.boardRole` the API already returns (viewers read-only) — 10 min
- Move `isFavorite` off `Board` onto the (user, board) pair — 15 min

*The favourite fix has to land with sharing: today one member favouriting a board
favourites it for everyone. Until now that was invisible because nobody could share.*

### Sprint 8 — Notifications and mentions · 50 min

- Bell/inbox UI on `GET /notifications` + `PUT /:id/read` — 25 min
- `@` autocomplete in the comment panel, populating the `mentions[]` the model already
  has and the notification fan-out already reads — 25 min

*Both are pure frontend. The backend has been writing notification rows this whole time.*

### Sprint 9 — Images · 45 min

- Image tool → `POST /uploads/image` → drop a `fabric.Image` on the canvas
- Paste from clipboard and drag-and-drop

⚠ Uploads land on the container filesystem. On Render's free tier they vanish on every
restart — move to S3 or Cloudinary before this counts as done in production.

### Sprint 10 — Performance under load · 70 min

- Viewport culling — 25 min
- Paginate the initial object load — 20 min
- Throttle `object:moving` emits — 10 min
- Per-socket rate limiting — 15 min

### Sprint 11 — Scale-out prep · 40 min

- socket.io Redis adapter
- Move the in-memory presence `Map` behind it

*Presence is a per-process map today: correct on one instance, wrong the moment you run two.*

### Sprint 12 — Auth hardening · 60 min

- JWT out of `localStorage`, into an httpOnly cookie
- Refresh token rotation

*Touches every request path. Do it once the feature surface has stopped moving.*

### Sprint 13 — Hygiene · 75 min

- zod request validation on the API — 25 min
- CI: typecheck + lint + the Sprint 0 test — 20 min
- `aria-label`s on the icon-only toolbar buttons — 15 min
- Debounce dashboard search (a request per keystroke today); paginate `GET /boards` — 15 min

---

## The Yjs fork · 180–300 min

Real concurrent editing. Today two people dragging the same object simply overwrite each
other — last write wins, no OT, no CRDT, no locking.

| | |
|---|---|
| **14a** Swap the object store to a `Y.Map`, keep the socket transport | 120 min |
| **14b** `Y.UndoManager` replaces the 100-entry local history stack | 60 min |
| **14c** Awareness replaces the custom presence map and cursor plumbing | 60 min |

**Decide this before Sprint 3.** Yjs subsumes Sprint 3 entirely, half of Sprint 6, and
most of Sprint 11 — roughly 90 minutes of the core track becomes wasted work if you do
both. If you want concurrent editing but not now, the cheap stand-in is a per-object
Lamport counter to reject stale writes (~30 min, fits in Sprint 2).

---

## Feature sprints

Independent of each other and of everything after Sprint 5. Pick by what you want the app
to *be*.

| Sprint | Est. | Notes |
|---|---|---|
| Snapping + alignment guides | 45 min | |
| Comment pins on the canvas | 40 min | `x`, `y`, `parentComment` already on the model; the panel posts `x: 0, y: 0` |
| Follow-me presenter mode | 30 min | |
| AI sticky-note clustering | 60 min | Claude API call over the note text |
| Connectors that stick to shapes | 90 min | ⚠ highest overrun risk — attachment points touch every transform path in `CanvasBoard.tsx` |
| Frames + templates | 120 min | Worth splitting in two: frames first, then a template picker |
| Touch + mobile | 60–120 min | ⚠ wide estimate — Fabric 6 touch needs fiddling against real devices |

---

## Where the estimates are soft

**Verification is the long pole, not writing code.** Anything touching collaboration needs
two clients actually connected; you can't validate it by reading the diff. That's the whole
argument for Sprint 0 going first.

**Confidence drops as you go down.** Sprints 1 and 2 are near-certain. Connectors and
touch/mobile are the two I'd expect to overrun.

**Sprint order encodes dependencies, not priority.** If you only ever do three of these,
do 1, 2, and 5 — that's the security hole, the write amplification, and the first thing a
user would notice.
