import express from 'express';
import { protect } from '../middleware/auth.js';
import { requireBoardAccess } from '../middleware/boardAccess.js';
import {
  listBoards,
  createBoard,
  getBoard,
  updateBoard,
  deleteBoard,
  duplicateBoard,
  setFavorite,
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
} from '../controllers/boardController.js';

const router = express.Router();
router.use(protect);

router.get('/', listBoards);
router.post('/', createBoard);
router.get('/:boardId', requireBoardAccess('viewer'), getBoard);
router.put('/:boardId', requireBoardAccess('editor'), updateBoard);
router.delete('/:boardId', requireBoardAccess('owner'), deleteBoard);
router.post('/:boardId/duplicate', requireBoardAccess('viewer'), duplicateBoard);

// A favourite is the viewer's own bookmark, so it needs no write access to the
// board itself -- unlike everything else on PUT /:boardId.
router.put('/:boardId/favorite', requireBoardAccess('viewer'), setFavorite);

// Anyone on the board can see who else is on it; only the owner can change it.
router.get('/:boardId/members', requireBoardAccess('viewer'), listMembers);
router.post('/:boardId/invite', requireBoardAccess('owner'), inviteMember);
router.put('/:boardId/members/:userId', requireBoardAccess('owner'), updateMemberRole);
router.delete('/:boardId/members/:userId', requireBoardAccess('owner'), removeMember);

export default router;
