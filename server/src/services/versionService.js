import CanvasObject from '../models/CanvasObject.js';
import Version from '../models/Version.js';

const MAX_VERSIONS_PER_BOARD = 50;

/**
 * Snapshots a board from its own CanvasObject rows rather than from whatever a
 * client claims its canvas holds. Since Sprint 2 the socket path is the only
 * writer, so the database is the authoritative copy — and a snapshot built from
 * it cannot be poisoned by a client that connected mid-edit or is a few events
 * behind. It also means the socket layer can capture a version without a
 * browser being involved at all.
 */
export async function captureVersion(boardId, userId, label = '') {
  const objects = await CanvasObject.find({ board: boardId }).sort({ zIndex: 1 }).lean();

  const version = await Version.create({
    board: boardId,
    snapshot: {
      objects: objects.map(({ objectId, type, data, zIndex }) => ({
        objectId,
        type,
        data,
        zIndex: zIndex ?? 0,
      })),
    },
    label,
    createdBy: userId,
  });

  await pruneVersions(boardId);
  return version;
}

/** Keeps the most recent MAX_VERSIONS_PER_BOARD per board to bound storage. */
async function pruneVersions(boardId) {
  const count = await Version.countDocuments({ board: boardId });
  if (count <= MAX_VERSIONS_PER_BOARD) return;

  const oldest = await Version.find({ board: boardId })
    .sort({ createdAt: 1 })
    .limit(count - MAX_VERSIONS_PER_BOARD)
    .select('_id');
  await Version.deleteMany({ _id: { $in: oldest.map((v) => v._id) } });
}
