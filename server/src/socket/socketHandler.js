import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import CanvasObject from '../models/CanvasObject.js';

// In-memory presence map: boardId -> Map(socketId -> { userId, name, color, cursor })
// Fine for a single-instance deployment; for horizontal scaling you'd move
// this to Redis (socket.io-redis adapter) so state is shared across servers.
const presence = new Map();

function getRoomPresence(boardId) {
  if (!presence.has(boardId)) presence.set(boardId, new Map());
  return presence.get(boardId);
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

    // ---- Room lifecycle ----
    socket.on('board:join', ({ boardId }) => {
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
    });

    socket.on('board:leave', () => leaveBoard(socket, currentBoardId));
    socket.on('disconnect', () => leaveBoard(socket, currentBoardId));

    function leaveBoard(socket, boardId) {
      if (!boardId) return;
      const room = getRoomPresence(boardId);
      room.delete(socket.id);
      socket.to(boardId).emit('presence:left', { socketId: socket.id });
      socket.leave(boardId);
    }

    // ---- Live cursor ----
    socket.on('cursor:move', ({ boardId, x, y }) => {
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
      try {
        const saved = await CanvasObject.create({
          board: boardId,
          objectId: object.objectId,
          type: object.type,
          data: object.data,
          zIndex: object.zIndex || 0,
          createdBy: socket.user._id,
        });
        socket.to(boardId).emit('object:added', saved);
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to add object', detail: err.message });
      }
    });

    socket.on('object:update', async ({ boardId, objectId, data }) => {
      try {
        await CanvasObject.updateOne({ board: boardId, objectId }, { $set: { data } });
        socket.to(boardId).emit('object:updated', { objectId, data, by: socket.user._id });
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to update object', detail: err.message });
      }
    });

    socket.on('object:delete', async ({ boardId, objectId }) => {
      try {
        await CanvasObject.deleteOne({ board: boardId, objectId });
        socket.to(boardId).emit('object:deleted', { objectId, by: socket.user._id });
      } catch (err) {
        socket.emit('error:sync', { message: 'Failed to delete object', detail: err.message });
      }
    });

    socket.on('object:reorder', async ({ boardId, objectId, zIndex }) => {
      await CanvasObject.updateOne({ board: boardId, objectId }, { $set: { zIndex } });
      socket.to(boardId).emit('object:reordered', { objectId, zIndex });
    });

    // ---- Live "in progress" drawing broadcast (e.g. pencil strokes before mouseup) ----
    socket.on('draw:stream', ({ boardId, strokeId, points }) => {
      socket.to(boardId).emit('draw:stream', { strokeId, points, by: socket.user._id });
    });

    // ---- Realtime text editing (broadcast keystroke-level updates for a textbox) ----
    socket.on('text:edit', ({ boardId, objectId, text }) => {
      socket.to(boardId).emit('text:edit', { objectId, text, by: socket.user._id });
    });

    // ---- Comments ----
    socket.on('comment:new', ({ boardId, comment }) => {
      socket.to(boardId).emit('comment:new', comment);
    });
  });
}
