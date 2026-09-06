# REST API reference

Base URL: `http://localhost:5000/api` (client env var `VITE_API_URL`).

Auth: send `Authorization: Bearer <jwt>` on every protected route. The client's axios
interceptor attaches it from `localStorage.token` automatically and, on any `401`, clears
the token and redirects to `/login`.

Board-scoped routes additionally run `requireBoardAccess(minRole)` — the **Access** column
below gives the minimum role. Board owners always pass.

Errors are `{ message, stack? }` (`stack` only when `NODE_ENV !== 'production'`).

---

## Health

| Method | Path | Auth |
|---|---|---|
| GET | `/api/health` | none |

→ `{ status: 'ok', time: <ISO string>, ip: <caller's address> }`

`ip` is `req.ip`, echoed back so a deployment can be checked for its `trust proxy`
setting from outside. Call it against a deployed API: if it answers with your own
address, the hop count is right; if it answers with the platform's proxy address,
every visitor looks like the same person to the rate limiter.

---

## Auth — `/api/auth`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/signup` | none | `{ name, email, password }` | `201 { user, token }` |
| POST | `/login` | none | `{ email, password }` | `{ user, token }` |
| GET | `/me` | JWT | — | `{ user }` |
| POST | `/forgot-password` | none | `{ email }` | `{ message, devPreviewUrl }` |
| POST | `/reset-password/:token` | none | `{ password }` | `{ message, token }` |
| PUT | `/change-password` | JWT | `{ currentPassword, newPassword }` | `{ message }` |
| PUT | `/profile` | JWT | `{ name?, theme?, avatarUrl? }` | `{ user }` |

Details:

- **signup** — validates presence of all three fields, `validator.isEmail(email)`, and
  password ≥ 6. `409` if the email is already registered. Rate-limited to 20 / 15 min.
- **login** — returns a generic `401 Invalid email or password` for both unknown-email and
  wrong-password. Rate-limited to 20 / 15 min.
- **forgot-password** — always responds `If that email exists, a reset link has been sent`,
  whether or not the account exists, so it can't be used to enumerate accounts. Generates
  32 random bytes, emails the raw token in a link to `${CLIENT_URL}/reset-password/<raw>`,
  stores only its sha256 hash with a 1-hour expiry. `devPreviewUrl` is the Ethereal preview
  link — **remove that field when you wire up a real mail provider.**
- **reset-password/:token** — hashes the URL token, looks up a user with a matching,
  unexpired token, sets the new password (the `pre('save')` hook re-hashes it), clears the
  reset fields, and returns a fresh JWT.
- **profile** — only `name`, `theme`, `avatarUrl` are writable, and only when truthy.

`user` is always `toSafeObject()` — `{ id, name, email, avatarUrl, color, theme, createdAt }`.
Tokens are `jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN || '7d' })`.

---

## Boards — `/api/boards` (all routes JWT-protected)

| Method | Path | Access | Body / Query | Returns |
|---|---|---|---|---|
| GET | `/` | — | `?search=&filter=recent\|favorite\|shared` | `{ owned, shared }` |
| POST | `/` | — | `{ title? }` | `201 { board }` |
| GET | `/:boardId` | viewer | — | `{ board, role, objects }` |
| PUT | `/:boardId` | editor | `{ title?, background?, gridEnabled?, privacy?, thumbnail? }` | `{ board }` |
| DELETE | `/:boardId` | owner | — | `{ message }` |
| POST | `/:boardId/duplicate` | viewer | — | `201 { board }` |
| PUT | `/:boardId/favorite` | viewer | `{ isFavorite }` | `{ isFavorite }` |
| GET | `/:boardId/members` | viewer | — | `{ members: [{ user, role }] }` |
| POST | `/:boardId/invite` | owner | `{ email, role? }` | `{ member }` |
| PUT | `/:boardId/members/:userId` | owner | `{ role }` | `{ member }` |
| DELETE | `/:boardId/members/:userId` | owner | — | `{ message }` |

- **GET /** — `owned` is boards where you're the owner, sorted by `lastOpenedAt` desc;
  `shared` is boards you have a `BoardMember` row for. Every board is decorated with
  `role` (so the client can hide actions that would 403) and with `isFavorite` **for the
  requesting user**. `search` is a case-insensitive regex on title, applied to both lists;
  `filter=favorite` now filters both lists against the caller's Favorite rows, where it
  used to match a field on the board and therefore return no shared boards at all.
  `filter=shared` blanks `owned`; `filter=recent` truncates `shared` to 5. (There is still
  no pagination.)
- **GET /:boardId** — side effect: sets `lastOpenedAt = now`. Returns all canvas objects
  sorted by `zIndex`, which is what the editor rehydrates from, plus the caller's own
  `board.isFavorite`.
- **PUT /:boardId** — no longer accepts `isFavorite`; that moved to its own route because
  a favourite is the caller's bookmark and must not require write access.
- **PUT /:boardId/favorite** — creates or deletes one `Favorite` row for
  (caller, board). Requires only `viewer`.
- **DELETE** — cascades to BoardMember, CanvasObject, Version, Comment, Favorite.
- **duplicate** — creates `"<title> (copy)"` owned by **the caller** (so a viewer on a
  shared board can fork their own copy), and clones every CanvasObject.
- **GET /:boardId/members** — the owner first, then each BoardMember in creation order.
  A membership whose user has been deleted is skipped rather than returned blank.
- **invite** — looks the invitee up by lower-cased email (`404` if no such user — there is
  no invite-by-email-to-a-stranger flow), upserts the BoardMember, and creates a
  `board-shared` Notification.
- **invite / members/:userId** — `role` must be `editor` or `viewer`; anything else is a
  `400`. `owner` is deliberately not grantable: ownership is the `Board.owner` reference,
  and a second owner could delete the board out from under the first. Inviting the board's
  own owner is a `400` too. Both used to pass `req.body.role` straight to an update with no
  validators, so `owner` created a second owner and a junk string created a membership whose
  role matched nothing in `roleRank` — access silently gone.
- **members/:userId (PUT/DELETE)** — a role change or removal is pushed to any socket that
  user has in the board (`board:role`), so it takes effect immediately rather than at their
  next reconnect. Removal also deletes their Favorite row for the board, which would
  otherwise be a dashboard card that 403s when clicked.

---

## Canvas — `/api/canvas` (all routes JWT-protected)

| Method | Path | Access | Body | Returns |
|---|---|---|---|---|
| GET | `/:boardId/objects` | viewer | — | `{ objects }` |
| POST | `/:boardId/objects/bulk` | editor | `{ objects: [{ objectId, type, data, zIndex }] }` | `{ message }` |
| DELETE | `/:boardId/objects` | editor | — | `{ message, deletedCount }` |
| POST | `/:boardId/versions` | editor | `{ label? }` | `201 { version }` |
| GET | `/:boardId/versions` | viewer | — | `{ versions }` (no `snapshot`) |
| POST | `/:boardId/versions/:versionId/restore` | editor | — | `{ message, objects }` |

- **objects (DELETE)** — broadcasts `board:cleared` into the board room for the same reason
  restore does; without it everyone else keeps editing objects that no longer exist.
- **objects/bulk** — a `bulkWrite` of upserts keyed on `{ board, objectId }`. Reserved for
  JSON import; **the client no longer calls it**. It was the 10-second auto-save until
  Sprint 2 removed that. Idempotent, and it never deletes.
- **versions (POST)** — the snapshot is built **server-side** from the board's own
  `CanvasObject` rows; the body carries only an optional label. The client never sends a
  canvas. After inserting, prunes to the 50 newest versions for that board.
- **versions (POST)** is also called by the socket layer, with no HTTP request involved, once
  every `AUTO_VERSION_EVERY` object mutations (default 50) — see `services/versionService.js`.
- **restore** — looks the version up scoped to `{ _id, board }`: board access proves you may
  write to *this* board, so an unscoped lookup would let a version id pull another board's
  canvas into it. A malformed or foreign version id is a `404`. On success it broadcasts
  `board:restored` into the board room, so other people do not keep editing a canvas that no
  longer exists.
  **No client code calls this**, so the version timeline stays empty in practice — see
  [implementation-status.md](implementation-status.md).
- **restore** — destructive: deletes every CanvasObject for the board, then inserts
  `snapshot.objects` with `createdBy` set to the restoring user. Returns the new objects so
  the client can reload the canvas without a refetch. It does **not** broadcast over the
  socket, so other people in the room won't see the restore until they reload.

---

## Comments — `/api/comments` (all routes JWT-protected)

| Method | Path | Access | Body | Returns |
|---|---|---|---|---|
| GET | `/:boardId` | viewer | — | `{ comments }` |
| POST | `/:boardId` | editor | `{ text, x?, y?, mentions?, parentComment? }` | `201 { comment }` |
| PUT | `/comment/:commentId/resolve` | editor | `{ resolved? }` (default `true`) | `{ comment }` |
| DELETE | `/comment/:commentId` | viewer + author, or owner | — | `{ message }` |

- `GET` returns comments sorted oldest-first with `author` populated to
  `{ name, avatarUrl, color }`.
- `POST` fans out a `mention` Notification per entry in `mentions`, but only after
  filtering that list: ids must be well-formed, must belong to someone with access to the
  board, must be deduplicated, and must not be the author. `mentions` comes straight from
  the client, and until it had a UI nothing filled it in — so nothing checked it either,
  and it was a notification-sending primitive pointed at any user id in the system.
  Filtered ids are what gets stored on the comment, not what was sent.
- The two `/comment/:commentId` routes are keyed by comment id, not board id, so they run
  `requireCommentAccess(minRole)` instead — it loads the comment, then applies the same
  role check against the board the comment belongs to.
- `DELETE` succeeds for the comment's author or the board owner; anyone else gets `403`.
  An unknown or malformed comment id is `404`.

---

## Uploads — `/api/uploads`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/image` | JWT | `multipart/form-data`, field `image` | `201 { url, path }` |

Multer disk storage into `server/uploads/`, filename `<uuid><ext>`. Accepts
`image/png|jpeg|jpg|gif|webp` only, max 10 MB.

- **The extension comes from the media type, never from the filename.** It used to be
  `path.extname(file.originalname)`, which let the caller choose it: a file named
  `evil.html` and declared `image/png` was stored as `<id>.html` and handed back by
  `express.static` as `text/html`. That is stored XSS on the API's own origin — the origin
  every session token is sent to.
- A rejected type is a `400` and an oversized file a `413`. Both used to reach the generic
  error handler as a `500`, which made "your image is too big" indistinguishable from "the
  server fell over".
- `path` is the relative `/uploads/<filename>`; `url` prefixes it with `PUBLIC_URL`, or with
  the request's own `protocol://host` when that is unset. Clients should prefer `path` and
  resolve it against the API origin they already know: the `Host` header is client-supplied,
  and this URL does not stay with the uploader — it is written into the Fabric object's
  `src` and then loaded by every other member of the board.

`/uploads` is served by `express.static` with three response headers set explicitly:

| Header | Why |
|---|---|
| `Cross-Origin-Resource-Policy: cross-origin` | helmet defaults this to `same-origin`, and the client is never on this origin. The canvas is unaffected — it loads images in CORS mode, which CORP does not govern — but a plain `<img src>` pointed at an upload fails to load outright |
| `X-Content-Type-Options: nosniff` | behind the extension allowlist: whatever is in there is served as the type its extension says, and nothing else |
| `Content-Security-Policy: default-src 'none'; sandbox` | neutralises anything that slipped through and got interpreted as a document |

---

## Notifications — `/api/notifications` (handlers inline in the router)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/` | JWT | `{ notifications, unread }` — your 50 most recent, newest first |
| PUT | `/read-all` | JWT | `{ read }` — number marked |
| PUT | `/:id/read` | JWT | `{ notification }` — marks read, scoped to your own |

- `unread` is counted separately rather than derived from the page, since the list is
  capped at 50 and would under-report anyone with a real backlog.
- `read-all` is declared **before** `/:id/read` so the literal is never parsed as an id.
- `/:id/read` returns `404` for a malformed id (it used to reach Mongoose and come back a
  `500`) and for one that is not yours (it used to answer `200` with `notification: null`,
  making a miss indistinguishable from a hit).
- Rows are deleted with their board, and when a member is removed from a board — otherwise
  the bell keeps offering somewhere you cannot go.
