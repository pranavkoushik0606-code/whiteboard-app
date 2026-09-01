# Architecture

## Stack

| Layer | Technology |
|---|---|
| UI | React 19, React Router 6, Tailwind CSS 3 (class-based dark mode), lucide-react icons, Framer Motion |
| Canvas | Fabric.js 6 |
| Client state | Zustand 4 (`useAuthStore`, `useBoardStore`, `useCanvasStore`) + a React context for theme |
| Client transport | axios (REST, `src/lib/api.ts`), socket.io-client (realtime, `src/hooks/useSocket.ts`) |
| Build | Vite 5, TypeScript 5.5 |
| Server | Node 20, Express 4, ES modules (`"type": "module"`) |
| Realtime | Socket.io 4 |
| DB | MongoDB 7 via Mongoose 8 |
| Auth | JWT (`jsonwebtoken`) + bcryptjs |
| Files | Multer → local disk `server/uploads/`, served statically at `/uploads` |
| Email | Nodemailer → Ethereal auto-provisioned test inbox |

## Two transports, one canvas

The app deliberately splits work between REST and sockets:

- **REST (axios → Express)** handles anything that must work without a live socket:
  auth, the dashboard, initial board load, bulk import, version snapshots, comments.
- **Socket.io** handles the low-latency path: object add/update/delete/reorder, live
  cursors, presence join/leave, and comment broadcast.

Both write to the same `CanvasObject` collection. The socket handler persists as it
broadcasts (`object:add` → `CanvasObject.create` → emit `object:added` to the rest of the
room), so there is no separate "sync later" queue.

## Lifecycle of a board session

```
1. BoardEditor mounts
   GET /api/boards/:boardId          -> { board, role, objects }   (also bumps lastOpenedAt)
2. useSocket connects with the JWT in socket.handshake.auth.token
   io.use() verifies the token and attaches socket.user
   client emits board:join -> server joins room `boardId`
   server emits presence:sync (to joiner) + presence:joined (to everyone else)
3. CanvasBoard enlivens `objects` into Fabric objects and renders them
4. User draws / edits
   local Fabric event -> emit object:add|update|delete
   -> server persists to Mongo -> broadcasts object:added|updated|deleted to the room
   -> remote clients apply the change with isRemoteUpdate guard so it doesn't echo back
5. Every 10s the client bulk-upserts the whole canvas (POST /canvas/:id/objects/bulk)
6. On unmount: emit board:leave, disconnect; server removes the presence entry
```

## Object identity

Every Fabric object gets a client-generated `objectId` (uuid v4) stashed on the instance
and serialized via `toObject(['objectId'])`. That id — not array position or Mongo `_id` —
is the join key across clients and across the socket/REST boundary. `CanvasObject` has a
unique compound index on `{ board, objectId }`, which is what makes the bulk-upsert
idempotent.

## Authorization model

Two layers:

- `protect` (`middleware/auth.js`) — verifies the `Authorization: Bearer <jwt>` header,
  loads the user, attaches `req.user`. Applied to every route except signup/login/
  forgot-password/reset-password and `/api/health`.
- `requireBoardAccess(minRole)` (`middleware/boardAccess.js`) — the board owner always
  passes; otherwise a `BoardMember` row must exist with rank ≥ `minRole`, where
  `viewer(0) < editor(1) < owner(2)`. Attaches `req.board` and `req.boardRole`.

Socket connections re-verify the same JWT in `io.use()` but do **not** run a board-access
check on `board:join` — see [implementation-status.md](implementation-status.md#known-gaps--bugs).

## Presence

Presence lives in a module-level `Map` in `socket/socketHandler.js`:
`boardId -> Map(socketId -> { userId, name, color, cursor })`. This is in-memory and
single-instance only; horizontal scaling would need the Redis adapter. Each user gets a
random color assigned at signup (`User.color`) which drives their cursor and avatar.

## Security middleware (server/src/index.js)

- `helmet()` — standard security headers
- `cors({ origin: CLIENT_URL, credentials: true })` — same origin config reused for Socket.io
- `express.json({ limit: '2mb' })`
- `express-mongo-sanitize` — strips `$`/`.` from body/query/params (NoSQL injection)
- `morgan` — `dev` locally, `combined` in production
- Rate limits — 300 req / 15 min on all of `/api`; a stricter 20 / 15 min on
  `/api/auth/login` and `/api/auth/signup`
- `notFound` + `errorHandler` — JSON errors, stack trace suppressed when `NODE_ENV=production`

## Directory map

```
server/
  src/
    index.js               Express app, middleware chain, route mounting, Socket.io bootstrap
    config/db.js           Mongoose connection (exits process on failure)
    models/                User, Board, BoardMember, CanvasObject, Comment, Notification, Version
    middleware/            auth.js (JWT), boardAccess.js (roles), errorHandler.js
    controllers/           auth, board, canvas, comment, upload
    routes/                authRoutes, boardRoutes, canvasRoutes, commentRoutes,
                           uploadRoutes (inline multer config), notificationRoutes (inline handlers)
    socket/socketHandler.js  auth middleware, rooms, presence map, all realtime events
    utils/                 asyncHandler, generateToken, sendEmail
  uploads/                 local image storage (gitignored except .gitkeep)

client/
  src/
    main.tsx               BrowserRouter + ThemeProvider + StrictMode
    App.tsx                route table, calls authStore.hydrate() on boot
    lib/api.ts             axios instance, token interceptor, 401 -> redirect to /login
    hooks/useSocket.ts     one socket per board session
    context/ThemeContext.tsx  light/dark, persisted to localStorage, toggles `.dark` on <html>
    store/                 useAuthStore, useBoardStore, useCanvasStore
    canvas/CanvasBoard.tsx Fabric engine + exported helpers (autoSaveBoard, exportPNG/JPEG/JSON)
    components/            Toolbar, PresenceCursors, CommentsPanel, VersionHistoryPanel,
                           ExportMenu, ProtectedRoute
    pages/                 Login, Signup, ForgotPassword, ResetPassword, Dashboard,
                           BoardEditor, Settings

docker-compose.yml         mongo + server + client, one command
render.yaml                backend web service definition (rootDir: server)
client/vercel.json         SPA build + rewrite-all-to-index.html
```

## Notable design decisions

- **One Mongo document per canvas object**, with the raw Fabric JSON in a `Mixed` `data`
  field. Keeps per-object realtime updates cheap; costs a full-collection read on load.
- **Snapshot version history** (`Version.snapshot` = whole Fabric export) rather than a
  diff/operation log. Restore is destructive: delete all objects for the board, re-insert
  from the snapshot. Capped at the 50 most recent versions per board.
- **No OT / CRDT.** Conflict resolution is last-write-wins per object. Two people dragging
  the same shape will fight; two people on different shapes are fine.
- **Local disk instead of Cloudinary** and **Ethereal instead of real SMTP** — both chosen
  so the project boots with no external accounts. Swap points are documented in
  [setup-and-deployment.md](setup-and-deployment.md).
