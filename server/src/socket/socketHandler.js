import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import CanvasObject from '../models/CanvasObject.js';
import { getBoardRole, hasRole } from '../middleware/boardAccess.js';
import { captureVersion } from '../services/versionService.js';

// In-memory presence map: boardId -> Map(socketId -> { userId, name, color, cursor })
// Fine for a single-instance deployment; for horizontal scaling you'd move
// this to Redis (socket.io-redis adapter) so state is shared across servers.
const presence = new Map();

function getRoomPresence(boardId) {
  if (!presence.has(boardId)) presence.set(boardId, new Map());
  return presence.get(boardId);
}

// One version every N object mutations, so the timeline fills up without anyone
// remembering to press save. Counted here rather than in the browser because
// five people on one board should produce one timeline, not five. Sprint 2
// removed the 10s auto-save this was originally meant to ride on; mutations are
// the replacement trigger. Overridable so the e2e suite does not have to make
// fifty edits to see one version.
const AUTO_VERSION_EVERY = Number(process.env.AUTO_VERSION_EVERY) || 50;
const mutationCounts = new Map();

async function countMutation(boardId, userId) {
  const next = (mutationCounts.get(boardId) || 0) + 1;
  if (next < AUTO_VERSION_EVERY) {
    mutationCounts.set(boardId, next);
    return;
  }
  mutationCounts.set(boardId, 0);
  try {
    await captureVersion(boardId, userId);
  } catch (err) {
    // A failed snapshot must never take the mutation down with it -- the object
    // write it followed has already been persisted and broadcast.
    console.error('[versions] auto-capture failed:', err.message);
  }
}

export function initSocket(io) {
  // Authenticate the socket using the same JWT issued at login
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token provided'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    let currentBoardId = null;

    // Boards this socket has been authorized on, and at what role. Every event
    // below carries a client-supplied boardId, so each one is checked against
    // this map — a valid JWT alone must never be enough to read or write a
    // board. Roles are cached at join time rather than re-queried per event
    // (cursor:move alone runs ~25x/second); the trade-off is that revoking
    // access takes effect on the member's next reconnect.
    const boardRoles = new Map();

    /**
     * Returns true when this socket may perform a `minRole` action on boardId.
     * Denials are reported on `error:auth` and the caller does nothing further.
     */
    function authorized(boardId, minRole) {
      if (boardId && hasRole(boardRoles.get(boardId), minRole)) return true;
      socket.emit('error:auth', {
        message: 'You do not have permission to do that on this board',
        boardId,
        required: minRole,
      });
      return false;
    }

    // ---- Room lifecycle ----
    socket.on('board:join', async ({ boardId }) => {
      try {
        const { role } = await getBoardRole(socket.user._id, boardId);
        if (!hasRole(role, 'viewer')) {
          return socket.emit('error:auth', {
            message: 'You do not have access to this board',
            boardId,
            required: 'viewer',
          });
        }

        boardRoles.set(boardId, role);
        currentBoardId = boardId;
        socket.join(boardId);

        const room = getRoomPresence(boardId);
        room.set(socket.id, {
          userId: socket.user._id.toString(),
          name: socket.user.name,
          color: socket.user.color,
          cursor: { x: 0, y: 0 },
        });

        socket.to(boardId).emit('presence:joined', room.get(socket.id));
        socket.emit('presence:sync', Array.from(room.values()));
      } catch (err) {
        socket.emit('error:auth', { message: 'Could not join board', detail: err.message });
      }
    });

    socket.on('board:leave', () => leaveBoard(socket, currentBoardId));
    socket.on('disconnect', () => leaveBoard(socket, currentBoardId));

    function leaveBoard(socket, boardId) {
      if (!boardId) return;
      const room = getRoomPresence(boardId);
      room.delete(socket.id);
      socket.to(boardId).emit('presence:left', { socketId: socket.id });
      socket.leave(boardId);
      boardRoles.delete(boardId);
    }

    // ---- Live cursor ----
    socket.on('cursor:move', ({ boardId, x, y }) => {
      if (!authorized(boardId, 'viewer')) return;
      const room = getRoomPresence(boardId);
      const entry = room.get(socket.id);
      if (entry) entry.cursor = { x, y };
      socket.to(boardId).emit('cursor:update', {
        socketId: socket.id,
        userId: socket.user._id,
        name: socket.user.name,
        color: socket.user.color,
        x,
        y,
      });
    });

    // ---- Object create/update/move/delete (shapes, sticky notes, text, drawing strokes) ----
    socket.on('object:add', async ({ boardId, object }) => {
      if (!authorized(boardId, 'editor')) return;
      try {
        // Upsert rather than create: undo/redo replays an add for an object
        // that may or may not still have a row (undo a delete, then redo, then
        // undo again). { board, objectId } is uniquely indexed, so a plain
        // create would throw a duplicate-key error on the second pass.
        const saved = await CanvasObject.findOneAndUpdate(
          { board: boardId, objectId: object.objectId },
          {
            $set: {
              type: object.type,
              data: object.data,
              zIndex: object.zIndex || 0,
            },
            $setOnInsert: { createdBy: socket.user._id },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        socket.to(boardId).emit('object:added', saved);
        await countMutation(boardId, socket.user._id);
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to add object', detail: err.message });
      }
    });

    socket.on('object:update', async ({ boardId, objectId, data }) => {
      if (!authorized(boardId, 'editor')) return;
      try {
        await CanvasObject.updateOne({ board: boardId, objectId }, { $set: { data } });
        socket.to(boardId).emit('object:updated', { objectId, data, by: socket.user._id });
        await countMutation(boardId, socket.user._id);
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to update object', detail: err.message });
      }
    });

    socket.on('object:delete', async ({ boardId, objectId }) => {
      if (!authorized(boardId, 'editor')) return;
      try {
        await CanvasObject.deleteOne({ board: boardId, objectId });
        socket.to(boardId).emit('object:deleted', { objectId, by: socket.user._id });
        await countMutation(boardId, socket.user._id);
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to delete object', detail: err.message });
      }
    });

    socket.on('object:reorder', async ({ boardId, objectId, zIndex }) => {
      if (!authorized(boardId, 'editor')) return;
      try {
        await CanvasObject.updateOne({ board: boardId, objectId }, { $set: { zIndex } });
        socket.to(boardId).emit('object:reordered', { objectId, zIndex });
        await countMutation(boardId, socket.user._id);
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to reorder object', detail: err.message });
      }
    });

    // ---- Live "in progress" drawing broadcast (e.g. pencil strokes before mouseup) ----
    socket.on('draw:stream', ({ boardId, strokeId, points }) => {
      if (!authorized(boardId, 'editor')) return;
      socket.to(boardId).emit('draw:stream', { strokeId, points, by: socket.user._id });
    });

    // ---- Realtime text editing (broadcast keystroke-level updates for a textbox) ----
    socket.on('text:edit', ({ boardId, objectId, text }) => {
      if (!authorized(boardId, 'editor')) return;
      socket.to(boardId).emit('text:edit', { objectId, text, by: socket.user._id });
    });

    // ---- Comments ----
    // Matches POST /api/comments/:boardId, which also requires 'editor'.
    socket.on('comment:new', ({ boardId, comment }) => {
      if (!authorized(boardId, 'editor')) return;
      socket.to(boardId).emit('comment:new', comment);
    });
  });
}
