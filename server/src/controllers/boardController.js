import Board from '../models/Board.js';
import BoardMember from '../models/BoardMember.js';
import CanvasObject from '../models/CanvasObject.js';
import Version from '../models/Version.js';
import Comment from '../models/Comment.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// @route GET /api/boards  (dashboard: recent/favorite/shared, search, pagination)
export const listBoards = asyncHandler(async (req, res) => {
  const { search, filter } = req.query; // filter: recent | favorite | shared
  const ownedQuery = { owner: req.user._id };

  if (search) ownedQuery.title = { $regex: search, $options: 'i' };
  if (filter === 'favorite') ownedQuery.isFavorite = true;

  let owned = await Board.find(ownedQuery).sort({ lastOpenedAt: -1 }).lean();

  let shared = [];
  if (filter !== 'favorite') {
    const memberships = await BoardMember.find({ user: req.user._id }).select('board role');
    const boardIds = memberships.map((m) => m.board);
    const sharedQuery = { _id: { $in: boardIds } };
    if (search) sharedQuery.title = { $regex: search, $options: 'i' };
    shared = await Board.find(sharedQuery).sort({ lastOpenedAt: -1 }).lean();
  }

  if (filter === 'shared') owned = [];
  if (filter === 'recent') shared = shared.slice(0, 5);

  res.json({ owned, shared });
});

// @route POST /api/boards
export const createBoard = asyncHandler(async (req, res) => {
  const board = await Board.create({
    title: req.body.title || 'Untitled Board',
    owner: req.user._id,
  });
  res.status(201).json({ board });
});

// @route GET /api/boards/:boardId
export const getBoard = asyncHandler(async (req, res) => {
  const board = req.board;
  board.lastOpenedAt = Date.now();
  await board.save();
  const objects = await CanvasObject.find({ board: board._id }).sort({ zIndex: 1 });
  res.json({ board, role: req.boardRole, objects });
});

// @route PUT /api/boards/:boardId  (rename, background, grid, privacy)
export const updateBoard = asyncHandler(async (req, res) => {
  const { title, background, gridEnabled, privacy, isFavorite, thumbnail } = req.body;
  const board = req.board;
  if (title !== undefined) board.title = title;
  if (background !== undefined) board.background = background;
  if (gridEnabled !== undefined) board.gridEnabled = gridEnabled;
  if (privacy !== undefined) board.privacy = privacy;
  if (isFavorite !== undefined) board.isFavorite = isFavorite;
  if (thumbnail !== undefined) board.thumbnail = thumbnail;
  await board.save();
  res.json({ board });
});

// @route DELETE /api/boards/:boardId
export const deleteBoard = asyncHandler(async (req, res) => {
  const boardId = req.board._id;
  await Promise.all([
    Board.deleteOne({ _id: boardId }),
    BoardMember.deleteMany({ board: boardId }),
    CanvasObject.deleteMany({ board: boardId }),
    Version.deleteMany({ board: boardId }),
    Comment.deleteMany({ board: boardId }),
  ]);
  res.json({ message: 'Board deleted' });
});

// @route POST /api/boards/:boardId/duplicate
export const duplicateBoard = asyncHandler(async (req, res) => {
  const original = req.board;
  const copy = await Board.create({
    title: `${original.title} (copy)`,
    owner: req.user._id,
    background: original.background,
    gridEnabled: original.gridEnabled,
  });
  const objects = await CanvasObject.find({ board: original._id }).lean();
  if (objects.length) {
    await CanvasObject.insertMany(
      objects.map(({ _id, ...o }) => ({ ...o, board: copy._id }))
    );
  }
  res.status(201).json({ board: copy });
});

// @route POST /api/boards/:boardId/invite  { email, role }
export const inviteMember = asyncHandler(async (req, res) => {
  const { email, role } = req.body;
  const User = (await import('../models/User.js')).default;
  const invitee = await User.findOne({ email });
  if (!invitee) return res.status(404).json({ message: 'No user found with that email' });

  const membership = await BoardMember.findOneAndUpdate(
    { board: req.board._id, user: invitee._id },
    { role: role || 'editor' },
    { upsert: true, new: true }
  );

  const Notification = (await import('../models/Notification.js')).default;
  await Notification.create({
    user: invitee._id,
    type: 'board-shared',
    message: `${req.user.name} invited you to "${req.board.title}"`,
    board: req.board._id,
  });

  res.json({ membership });
});
