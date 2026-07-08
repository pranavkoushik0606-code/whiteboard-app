import CanvasObject from '../models/CanvasObject.js';
import Version from '../models/Version.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Note: during an active session, real-time object create/update/delete/move
// happens over Socket.io (see socket/socketHandler.js) for low latency.
// These REST endpoints exist for initial load, bulk import, and anything
// that should work even without a live socket connection.

// @route GET /api/canvas/:boardId/objects
export const listObjects = asyncHandler(async (req, res) => {
  const objects = await CanvasObject.find({ board: req.params.boardId }).sort({ zIndex: 1 });
  res.json({ objects });
});

// @route POST /api/canvas/:boardId/objects/bulk  (used by JSON import)
export const bulkUpsertObjects = asyncHandler(async (req, res) => {
  const { objects } = req.body; // array of { objectId, type, data, zIndex }
  const boardId = req.params.boardId;
  const ops = objects.map((o) => ({
    updateOne: {
      filter: { board: boardId, objectId: o.objectId },
      update: { $set: { ...o, board: boardId, createdBy: req.user._id } },
      upsert: true,
    },
  }));
  if (ops.length) await CanvasObject.bulkWrite(ops);
  res.json({ message: `${ops.length} objects saved` });
});

// @route DELETE /api/canvas/:boardId/objects
export const clearObjects = asyncHandler(async (req, res) => {
  await CanvasObject.deleteMany({ board: req.params.boardId });
  res.json({ message: 'Canvas cleared' });
});

// @route POST /api/canvas/:boardId/versions  (manual "save version" / auto-save snapshot)
export const createVersion = asyncHandler(async (req, res) => {
  const { snapshot, label } = req.body;
  const version = await Version.create({
    board: req.params.boardId,
    snapshot,
    label: label || '',
    createdBy: req.user._id,
  });
  // Keep only the most recent 50 versions per board to bound storage growth
  const count = await Version.countDocuments({ board: req.params.boardId });
  if (count > 50) {
    const oldest = await Version.find({ board: req.params.boardId })
      .sort({ createdAt: 1 })
      .limit(count - 50);
    await Version.deleteMany({ _id: { $in: oldest.map((v) => v._id) } });
  }
  res.status(201).json({ version });
});

// @route GET /api/canvas/:boardId/versions  (timeline view)
export const listVersions = asyncHandler(async (req, res) => {
  const versions = await Version.find({ board: req.params.boardId })
    .select('-snapshot')
    .sort({ createdAt: -1 });
  res.json({ versions });
});

// @route POST /api/canvas/:boardId/versions/:versionId/restore
export const restoreVersion = asyncHandler(async (req, res) => {
  const version = await Version.findById(req.params.versionId);
  if (!version) return res.status(404).json({ message: 'Version not found' });

  // Wipe current objects and replace with the snapshot's object list.
  await CanvasObject.deleteMany({ board: req.params.boardId });
  const objects = version.snapshot?.objects || [];
  if (objects.length) {
    await CanvasObject.insertMany(
      objects.map((o) => ({ ...o, board: req.params.boardId, createdBy: req.user._id }))
    );
  }
  res.json({ message: 'Version restored', objects });
});
