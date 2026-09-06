import mongoose from 'mongoose';
import Board from '../models/Board.js';
import BoardMember from '../models/BoardMember.js';
import CanvasObject from '../models/CanvasObject.js';
import Version from '../models/Version.js';
import Comment from '../models/Comment.js';
import Favorite from '../models/Favorite.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { syncBoardRole } from '../socket/socketHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Roles an owner can hand out. 'owner' is deliberately not on the list: it is
// held by the Board.owner reference, and granting it through a membership row
// would produce a second owner who could delete the board out from under the
// first. The enum on BoardMember still permits it so getBoardRole keeps working
// for any row written before this check existed.
const SHAREABLE_ROLES = ['editor', 'viewer'];

const badRole = (res) =>
  res.status(400).json({ message: 'Role must be one of: ' + SHAREABLE_ROLES.join(', ') });

// @route GET /api/boards  (dashboard: recent/favorite/shared, search, pagination)
export const listBoards = asyncHandler(async (req, res) => {
  const { search, filter } = req.query; // filter: recent | favorite | shared

  const [favorites, memberships] = await Promise.all([
    Favorite.find({ user: req.user._id }).select('board').lean(),
    BoardMember.find({ user: req.user._id }).select('board role').lean(),
  ]);
  const favoriteIds = favorites.map((f) => f.board);
  const favoriteSet = new Set(favoriteIds.map(String));
  const roleByBoard = new Map(memberships.map((m) => [String(m.board), m.role]));

  // Both lists are filtered the same way now. `favorite` used to be a field on
  // the board itself and so could only ever match a board you owned — a board
  // shared with you could not be favourited at all.
  const queryFor = (base) => {
    const clauses = [base];
    if (search) clauses.push({ title: { $regex: search, $options: 'i' } });
    if (filter === 'favorite') clauses.push({ _id: { $in: favoriteIds } });
    return { $and: clauses };
  };

  let owned = await Board.find(queryFor({ owner: req.user._id }))
    .sort({ lastOpenedAt: -1 })
    .lean();
  let shared = await Board.find(queryFor({ _id: { $in: memberships.map((m) => m.board) } }))
    .sort({ lastOpenedAt: -1 })
    .lean();

  if (filter === 'shared') owned = [];
  if (filter === 'recent') shared = shared.slice(0, 5);

  // `role` rides along so the dashboard can hide actions a member cannot take,
  // rather than offering a rename that comes back 403.
  const decorate = (board, role) => ({
    ...board,
    role,
    isFavorite: favoriteSet.has(String(board._id)),
  });

  res.json({
    owned: owned.map((b) => decorate(b, 'owner')),
    shared: shared.map((b) => decorate(b, roleByBoard.get(String(b._id)) || 'viewer')),
  });
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
  const favorite = await Favorite.exists({ user: req.user._id, board: board._id });
  res.json({
    board: { ...board.toObject(), isFavorite: Boolean(favorite) },
    role: req.boardRole,
    objects,
  });
});

// @route PUT /api/boards/:boardId  (rename, background, grid, privacy)
export const updateBoard = asyncHandler(async (req, res) => {
  // isFavorite is deliberately not accepted here: it belongs to the (user,
  // board) pair now, and this route requires editor — a viewer may still
  // bookmark a board. See PUT /:boardId/favorite.
  const { title, background, gridEnabled, privacy, thumbnail } = req.body;
  const board = req.board;
  if (title !== undefined) board.title = title;
  if (background !== undefined) board.background = background;
  if (gridEnabled !== undefined) board.gridEnabled = gridEnabled;
  if (privacy !== undefined) board.privacy = privacy;
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
    Favorite.deleteMany({ board: boardId }),
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

// @route PUT /api/boards/:boardId/favorite  { isFavorite }  (viewer)
export const setFavorite = asyncHandler(async (req, res) => {
  const isFavorite = req.body.isFavorite !== false;
  const key = { user: req.user._id, board: req.board._id };
  if (isFavorite) {
    await Favorite.updateOne(key, { $setOnInsert: key }, { upsert: true });
  } else {
    await Favorite.deleteOne(key);
  }
  res.json({ isFavorite });
});

// @route GET /api/boards/:boardId/members  (viewer)
export const listMembers = asyncHandler(async (req, res) => {
  const owner = await User.findById(req.board.owner).select('name email color').lean();
  const memberships = await BoardMember.find({ board: req.board._id })
    .populate('user', 'name email color')
    .sort({ createdAt: 1 })
    .lean();

  res.json({
    members: [
      ...(owner ? [{ user: owner, role: 'owner' }] : []),
      // A membership whose user has been deleted would render as a blank row.
      ...memberships.filter((m) => m.user).map((m) => ({ user: m.user, role: m.role })),
    ],
  });
});

// @route POST /api/boards/:boardId/invite  { email, role }  (owner)
export const inviteMember = asyncHandler(async (req, res) => {
  const role = req.body.role || 'editor';
  if (!SHAREABLE_ROLES.includes(role)) return badRole(res);

  const email = String(req.body.email || '').trim().toLowerCase();
  const invitee = await User.findOne({ email });
  if (!invitee) return res.status(404).json({ message: 'No user found with that email' });
  if (invitee._id.equals(req.board.owner)) {
    return res.status(400).json({ message: 'That user already owns this board' });
  }

  const membership = await BoardMember.findOneAndUpdate(
    { board: req.board._id, user: invitee._id },
    { role },
    { upsert: true, new: true }
  ).populate('user', 'name email color');

  syncBoardRole(req.app.get('io'), req.board._id, invitee._id, role);

  await Notification.create({
    user: invitee._id,
    type: 'board-shared',
    message: `${req.user.name} invited you to "${req.board.title}"`,
    board: req.board._id,
  });

  res.json({ member: { user: membership.user, role: membership.role } });
});

// @route PUT /api/boards/:boardId/members/:userId  { role }  (owner)
export const updateMemberRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!SHAREABLE_ROLES.includes(role)) return badRole(res);
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(404).json({ message: 'Member not found' });
  }

  const membership = await BoardMember.findOneAndUpdate(
    { board: req.board._id, user: req.params.userId },
    { role },
    { new: true }
  ).populate('user', 'name email color');
  if (!membership) return res.status(404).json({ message: 'Member not found' });

  syncBoardRole(req.app.get('io'), req.board._id, req.params.userId, role);

  res.json({ member: { user: membership.user, role: membership.role } });
});

// @route DELETE /api/boards/:boardId/members/:userId  (owner)
export const removeMember = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(404).json({ message: 'Member not found' });
  }

  const { deletedCount } = await BoardMember.deleteOne({
    board: req.board._id,
    user: req.params.userId,
  });
  if (!deletedCount) return res.status(404).json({ message: 'Member not found' });

  // A board they can no longer open would otherwise sit in their favourites as
  // a card that 403s when clicked.
  await Favorite.deleteOne({ user: req.params.userId, board: req.board._id });
  syncBoardRole(req.app.get('io'), req.board._id, req.params.userId, null);

  res.json({ message: 'Member removed' });
});
