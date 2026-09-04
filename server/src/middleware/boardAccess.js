import mongoose from 'mongoose';
import Board from '../models/Board.js';
import BoardMember from '../models/BoardMember.js';
import Comment from '../models/Comment.js';

export const roleRank = { viewer: 0, editor: 1, owner: 2 };

/** True when `role` (possibly null/undefined) is at least `minRole`. */
export const hasRole = (role, minRole = 'viewer') =>
  role != null && roleRank[role] !== undefined && roleRank[role] >= roleRank[minRole];

/**
 * Resolves a user's role on a board: 'owner' | 'editor' | 'viewer', or null if
 * they have no access (or the board does not exist).
 *
 * Shared by the REST middleware below and the socket layer, so both answer the
 * authorization question the same way.
 */
export async function getBoardRole(userId, boardId) {
  if (!mongoose.isValidObjectId(boardId)) return { board: null, role: null };

  const board = await Board.findById(boardId);
  if (!board) return { board: null, role: null };
  if (board.owner.equals(userId)) return { board, role: 'owner' };

  const membership = await BoardMember.findOne({ board: board._id, user: userId });
  return { board, role: membership ? membership.role : null };
}

// Confirms req.user has at least `minRole` access to req.params.boardId,
// and attaches `req.board` + `req.boardRole` for downstream handlers.
export const requireBoardAccess =
  (minRole = 'viewer') =>
  async (req, res, next) => {
    try {
      const { board, role } = await getBoardRole(req.user._id, req.params.boardId);
      if (!board) return res.status(404).json({ message: 'Board not found' });
      if (!hasRole(role, minRole)) {
        return res.status(403).json({ message: 'Insufficient permissions for this board' });
      }
      req.board = board;
      req.boardRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };

/**
 * Same check for routes keyed by a comment id rather than a board id — the
 * comment's board is what decides access. Attaches `req.comment`, `req.board`
 * and `req.boardRole`.
 */
export const requireCommentAccess =
  (minRole = 'viewer') =>
  async (req, res, next) => {
    try {
      const { commentId } = req.params;
      if (!mongoose.isValidObjectId(commentId)) {
        return res.status(404).json({ message: 'Comment not found' });
      }

      const comment = await Comment.findById(commentId);
      if (!comment) return res.status(404).json({ message: 'Comment not found' });

      const { board, role } = await getBoardRole(req.user._id, comment.board);
      if (!board) return res.status(404).json({ message: 'Board not found' });
      if (!hasRole(role, minRole)) {
        return res.status(403).json({ message: 'Insufficient permissions for this board' });
      }

      req.comment = comment;
      req.board = board;
      req.boardRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
