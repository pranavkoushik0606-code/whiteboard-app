import Notification from '../models/Notification.js';

/**
 * Writes a notification and pushes it to that user's sockets.
 *
 * Every connection joins `user:<id>` at handshake time, independently of any
 * board room — the dashboard has no board to join, and a bell that only fills
 * up on reload is half a bell.
 *
 * The write is what matters; the push is best-effort. `io` is undefined in any
 * context that has not wired the server in, and a user with no open tab simply
 * has no room to deliver to.
 */
export async function notify(io, { user, type, message, board }) {
  const notification = await Notification.create({ user, type, message, board });
  io?.to(`user:${user}`).emit('notification:new', notification);
  return notification;
}

/** The same, for a fan-out. Rows are inserted in one call, then pushed. */
export async function notifyAll(io, rows) {
  if (!rows.length) return [];
  const notifications = await Notification.insertMany(rows);
  notifications.forEach((n) => io?.to(`user:${n.user}`).emit('notification:new', n));
  return notifications;
}
