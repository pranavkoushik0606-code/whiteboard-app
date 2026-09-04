import express from 'express';
import { protect } from '../middleware/auth.js';
import { requireBoardAccess, requireCommentAccess } from '../middleware/boardAccess.js';
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
// Keyed by comment id, so access is decided by the comment's board.
router.put('/comment/:commentId/resolve', requireCommentAccess('editor'), resolveComment);
router.delete('/comment/:commentId', requireCommentAccess('viewer'), deleteComment);

export default router;
