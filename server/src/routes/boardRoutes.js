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
  inviteMember,
} from '../controllers/boardController.js';

const router = express.Router();
router.use(protect);

router.get('/', listBoards);
router.post('/', createBoard);
router.get('/:boardId', requireBoardAccess('viewer'), getBoard);
router.put('/:boardId', requireBoardAccess('editor'), updateBoard);
router.delete('/:boardId', requireBoardAccess('owner'), deleteBoard);
router.post('/:boardId/duplicate', requireBoardAccess('viewer'), duplicateBoard);
router.post('/:boardId/invite', requireBoardAccess('owner'), inviteMember);

export default router;
