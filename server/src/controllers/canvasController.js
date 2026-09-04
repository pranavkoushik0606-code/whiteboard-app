import mongoose from 'mongoose';
import CanvasObject from '../models/CanvasObject.js';
import Version from '../models/Version.js';
import { captureVersion } from '../services/versionService.js';
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

// @route POST /api/canvas/:boardId/versions  ("Save version" button)
// The body carries only an optional label: the snapshot is built server-side
// from the board's own rows. See services/versionService.js.
export const createVersion = asyncHandler(async (req, res) => {
  const version = await captureVersion(req.params.boardId, req.user._id, req.body.label || '');
  await version.populate('createdBy', 'name');
  res.status(201).json({ version });
});

// @route GET /api/canvas/:boardId/versions  (timeline view)
export const listVersions = asyncHandler(async (req, res) => {
  const versions = await Version.find({ board: req.params.boardId })
    .select('-snapshot')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });
  res.json({ versions });
});

// @route POST /api/canvas/:boardId/versions/:versionId/restore
export const restoreVersion = asyncHandler(async (req, res) => {
  const boardId = req.params.boardId;
  if (!mongoose.isValidObjectId(req.params.versionId)) {
    return res.status(404).json({ message: 'Version not found' });
  }

  // Scoped to the board on purpose: requireBoardAccess only proves you may
  // write to *this* board, so an unscoped lookup would let a version id pull
  // another board's canvas into it.
  const version = await Version.findOne({ _id: req.params.versionId, board: boardId });
  if (!version) return res.status(404).json({ message: 'Version not found' });

  // Wipe current objects and replace with the snapshot's object list. Fields
  // are mapped explicitly rather than spread, so nothing that happens to be in
  // an old snapshot (a stale _id, timestamps) is written back as-is.
  await CanvasObject.deleteMany({ board: boardId });
  const snapshot = version.snapshot?.objects || [];
  const objects = snapshot.length
    ? await CanvasObject.insertMany(
        snapshot.map(({ objectId, type, data, zIndex }) => ({
          board: boardId,
          objectId,
          type,
          data,
          zIndex: zIndex ?? 0,
          createdBy: req.user._id,
        }))
      )
    : [];

  // Everyone else in the room is holding a canvas that no longer exists. Until
  // Sprint 4 they kept it until they happened to reload.
  req.app.get('io')?.to(String(boardId)).emit('board:restored', {
    boardId: String(boardId),
    versionId: String(version._id),
    by: String(req.user._id),
    objects,
  });

  res.json({ message: 'Version restored', objects });
});
