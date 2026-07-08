import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// @route GET /api/comments/:boardId
export const listComments = asyncHandler(async (req, res) => {
  const comments = await Comment.find({ board: req.params.boardId })
    .populate('author', 'name avatarUrl color')
    .sort({ createdAt: 1 });
  res.json({ comments });
});

// @route POST /api/comments/:boardId
export const addComment = asyncHandler(async (req, res) => {
  const { text, x, y, mentions = [], parentComment = null } = req.body;
  const comment = await Comment.create({
    board: req.params.boardId,
    author: req.user._id,
    text,
    x,
    y,
    mentions,
    parentComment,
  });
  await comment.populate('author', 'name avatarUrl color');

  if (mentions.length) {
    await Notification.insertMany(
      mentions.map((userId) => ({
        user: userId,
        type: 'mention',
        message: `${req.user.name} mentioned you in a comment`,
        board: req.params.boardId,
      }))
    );
  }

  res.status(201).json({ comment });
});

// @route PUT /api/comments/:commentId/resolve
export const resolveComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findByIdAndUpdate(
    req.params.commentId,
    { resolved: req.body.resolved ?? true },
    { new: true }
  );
  res.json({ comment });
});

// @route DELETE /api/comments/:commentId
export const deleteComment = asyncHandler(async (req, res) => {
  await Comment.deleteOne({ _id: req.params.commentId, author: req.user._id });
  res.json({ message: 'Comment deleted' });
});
