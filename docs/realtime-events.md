# Realtime (Socket.io)

Server: `server/src/socket/socketHandler.js` — `initSocket(io)` called from `index.js`.
Client: `client/src/hooks/useSocket.ts` creates one connection per board session;
`CanvasBoard`, `PresenceCursors` and `CommentsPanel` attach their own listeners to it.

## Handshake

```js
io(SOCKET_URL, { auth: { token }, transports: ['websocket'] })
```

`io.use()` verifies the same JWT the REST API issues, loads the `User`, and attaches
`socket.user`. Connection is rejected with `No token provided`, `User not found`, or
`Authentication failed`.

⚠ Board membership is **not** checked — `board:join` accepts any board id from any
authenticated user. See [implementation-status.md](implementation-status.md#known-gaps--bugs).

## Rooms and presence

Each board is a Socket.io room keyed by `boardId`. Presence lives in a module-level
in-memory map: `boardId -> Map(socketId -> { userId, name, color, cursor })`. It is
per-process — a multi-instance deployment needs the Redis adapter for this to be correct.

`board:leave` and `disconnect` run the same cleanup, so a closed tab is handled.

## Client → server

| Event | Payload | Effect |
|---|---|---|
| `board:join` | `{ boardId }` | Joins the room, registers presence, emits `presence:joined` to others and `presence:sync` back to the joiner |
| `board:leave` | — | Removes presence, emits `presence:left`, leaves the room |
| `cursor:move` | `{ boardId, x, y }` | Updates the stored cursor, broadcasts `cursor:update` |
| `object:add` | `{ boardId, object: { objectId, type, data, zIndex? } }` | `CanvasObject.create(...)` then broadcasts `object:added` with the saved doc |
| `object:update` | `{ boardId, objectId, data }` | `updateOne` `$set: { data }` then broadcasts `object:updated` |
| `object:delete` | `{ boardId, objectId }` | `deleteOne` then broadcasts `object:deleted` |
| `object:reorder` | `{ boardId, objectId, zIndex }` | `updateOne` `$set: { zIndex }` then broadcasts `object:reordered` |
| `draw:stream` | `{ boardId, strokeId, points }` | Pure relay, no persistence — for in-progress stroke preview |
| `text:edit` | `{ boardId, objectId, text }` | Pure relay — for keystroke-level text sync |
| `comment:new` | `{ boardId, comment }` | Pure relay — the REST POST does the persisting |

## Server → client

| Event | Payload | Consumed by |
|---|---|---|
| `presence:sync` | `[{ userId, name, color, cursor }]` — full room roster, sent only to the joiner | `BoardEditor` (sets the online count) |
| `presence:joined` | `{ userId, name, color, cursor }` | `BoardEditor` (increments count) |
| `presence:left` | `{ socketId }` | `BoardEditor` (decrements), `PresenceCursors` (removes the cursor) |
| `cursor:update` | `{ socketId, userId, name, color, x, y }` | `PresenceCursors` |
| `object:added` | the saved `CanvasObject` doc | `CanvasBoard` |
| `object:updated` | `{ objectId, data, by }` | `CanvasBoard` |
| `object:deleted` | `{ objectId, by }` | `CanvasBoard` |
| `object:reordered` | `{ objectId, zIndex }` | *nothing yet* |
| `draw:stream` | `{ strokeId, points, by }` | *nothing yet* |
| `text:edit` | `{ objectId, text, by }` | *nothing yet* |
| `comment:new` | the comment | `CommentsPanel` |
| `error:sync` | `{ message, detail }` | *nothing yet* — sent to the originating socket when a DB write fails |

All broadcasts use `socket.to(boardId)`, i.e. everyone in the room **except** the sender —
the sender already applied the change locally.

## Echo prevention

`CanvasBoard` keeps an `isRemoteUpdate` ref. Before applying an incoming `object:added` /
`object:updated` it sets the flag, mutates the canvas, then clears it; the local
`object:modified` handler bails out while the flag is set, so a remote change never
re-broadcasts. Undo/redo (`loadFromJSON`) sets the same flag for the same reason.

## Throttling

`PresenceCursors` throttles `cursor:move` to one emit per 40 ms (~25 fps) using a plain
timestamp check on the global `mousemove` listener. Cursor coordinates are **viewport**
pixels (`e.clientX/Y`), not canvas coordinates — so remote cursors do not track correctly
when two people are panned or zoomed differently.

## Conflict resolution

None beyond last-write-wins per `objectId`. There is no OT or CRDT layer, no locking
(`CanvasObject.locked` exists but nothing reads it), and no server-side ordering guarantee
beyond Mongo's own.
