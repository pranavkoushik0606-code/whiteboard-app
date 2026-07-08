import express from 'express';
import { protect } from '../middleware/auth.js';
import { requireBoardAccess } from '../middleware/boardAccess.js';
import {
  listComments,
  addComment,
  resolveComment,
  deleteComment,
} from '../controllers/commentController.js';

const router = express.Router();
router.use(protect);

router.get('/:boardId', requireBoardAccess('viewer'), listComments);
router.post('/:boardId', requireBoardAccess('editor'), addComment);
router.put('/comment/:commentId/resolve', resolveComment);
router.delete('/comment/:commentId', deleteComment);

export default router;
