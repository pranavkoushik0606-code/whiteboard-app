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

→ `{ status: 'ok', time: <ISO string> }`

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
| PUT | `/:boardId` | editor | `{ title?, background?, gridEnabled?, privacy?, isFavorite?, thumbnail? }` | `{ board }` |
| DELETE | `/:boardId` | owner | — | `{ message }` |
| POST | `/:boardId/duplicate` | viewer | — | `201 { board }` |
| POST | `/:boardId/invite` | owner | `{ email, role? }` | `{ membership }` |

- **GET /** — `owned` is boards where you're the owner, sorted by `lastOpenedAt` desc;
  `shared` is boards you have a `BoardMember` row for. `search` is a case-insensitive
  regex on title, applied to both lists. `filter=favorite` restricts owned to
  `isFavorite: true` and returns no shared boards; `filter=shared` blanks `owned`;
  `filter=recent` truncates `shared` to 5. (There is no pagination.)
- **GET /:boardId** — side effect: sets `lastOpenedAt = now`. Returns all canvas objects
  sorted by `zIndex`, which is what the editor rehydrates from.
- **DELETE** — cascades to BoardMember, CanvasObject, Version, Comment.
- **duplicate** — creates `"<title> (copy)"` owned by **the caller** (so a viewer on a
  shared board can fork their own copy), and clones every CanvasObject.
- **invite** — looks the invitee up by email (`404` if no such user — there is no
  invite-by-email-to-a-stranger flow), upserts the BoardMember with `role` (default
  `editor`), and creates a `board-shared` Notification.

---

## Canvas — `/api/canvas` (all routes JWT-protected)

| Method | Path | Access | Body | Returns |
|---|---|---|---|---|
| GET | `/:boardId/objects` | viewer | — | `{ objects }` |
| POST | `/:boardId/objects/bulk` | editor | `{ objects: [{ objectId, type, data, zIndex }] }` | `{ message }` |
| DELETE | `/:boardId/objects` | editor | — | `{ message }` |
| POST | `/:boardId/versions` | editor | `{ snapshot, label? }` | `201 { version }` |
| GET | `/:boardId/versions` | viewer | — | `{ versions }` (no `snapshot`) |
| POST | `/:boardId/versions/:versionId/restore` | editor | — | `{ message, objects }` |

- **objects/bulk** — a `bulkWrite` of upserts keyed on `{ board, objectId }`. Used by the
  10-second auto-save and by JSON import. Idempotent; it never deletes, so objects removed
  from the canvas are cleared through the socket `object:delete` path, not here.
- **versions (POST)** — after inserting, prunes to the 50 newest versions for that board.
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
- `POST` fans out a `mention` Notification per entry in `mentions`.
- The two `/comment/:commentId` routes are keyed by comment id, not board id, so they run
  `requireCommentAccess(minRole)` instead — it loads the comment, then applies the same
  role check against the board the comment belongs to.
- `DELETE` succeeds for the comment's author or the board owner; anyone else gets `403`.
  An unknown or malformed comment id is `404`.

---

## Uploads — `/api/uploads`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/image` | JWT | `multipart/form-data`, field `image` | `201 { url }` |

Multer disk storage into `server/uploads/`, filename `<timestamp>-<random>.<ext>`.
Accepts `image/png|jpeg|jpg|gif|webp` only, max 10 MB. The returned `url` is
`${protocol}://${host}/uploads/<filename>`; the directory is served statically by
`express.static`. **No client code calls this endpoint yet.**

---

## Notifications — `/api/notifications` (handlers inline in the router)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/` | JWT | `{ notifications }` — your 50 most recent, newest first |
| PUT | `/:id/read` | JWT | `{ notification }` — marks read, scoped to your own |

**No client code calls these yet.**
