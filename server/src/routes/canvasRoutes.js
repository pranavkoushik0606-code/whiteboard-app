import express from 'express';
import { protect } from '../middleware/auth.js';
import { requireBoardAccess } from '../middleware/boardAccess.js';
import {
  listObjects,
  bulkUpsertObjects,
  clearObjects,
  createVersion,
  listVersions,
  restoreVersion,
} from '../controllers/canvasController.js';

const router = express.Router({ mergeParams: true });
router.use(protect);

router.get('/:boardId/objects', requireBoardAccess('viewer'), listObjects);
router.post('/:boardId/objects/bulk', requireBoardAccess('editor'), bulkUpsertObjects);
router.delete('/:boardId/objects', requireBoardAccess('editor'), clearObjects);

router.post('/:boardId/versions', requireBoardAccess('editor'), createVersion);
router.get('/:boardId/versions', requireBoardAccess('viewer'), listVersions);
router.post('/:boardId/versions/:versionId/restore', requireBoardAccess('editor'), restoreVersion);

export default router;
