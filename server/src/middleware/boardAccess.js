import Board from '../models/Board.js';
import BoardMember from '../models/BoardMember.js';

// Confirms req.user has at least `minRole` access to req.params.boardId,
// and attaches `req.board` + `req.boardRole` for downstream handlers.
const roleRank = { viewer: 0, editor: 1, owner: 2 };

export const requireBoardAccess =
  (minRole = 'viewer') =>
  async (req, res, next) => {
    try {
      const board = await Board.findById(req.params.boardId);
      if (!board) return res.status(404).json({ message: 'Board not found' });

      if (board.owner.equals(req.user._id)) {
        req.board = board;
        req.boardRole = 'owner';
        return next();
      }

      const membership = await BoardMember.findOne({ board: board._id, user: req.user._id });
      if (!membership || roleRank[membership.role] < roleRank[minRole]) {
        return res.status(403).json({ message: 'Insufficient permissions for this board' });
      }
      req.board = board;
      req.boardRole = membership.role;
      next();
    } catch (err) {
      next(err);
    }
  };
