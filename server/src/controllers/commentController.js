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

// @route PUT /api/comments/comment/:commentId/resolve
// requireCommentAccess('editor') has already loaded the comment and confirmed
// the caller has editor rights on its board.
export const resolveComment = asyncHandler(async (req, res) => {
  req.comment.resolved = req.body.resolved ?? true;
  await req.comment.save();
  res.json({ comment: req.comment });
});

// @route DELETE /api/comments/comment/:commentId
export const deleteComment = asyncHandler(async (req, res) => {
  const isAuthor = req.comment.author.equals(req.user._id);
  if (!isAuthor && req.boardRole !== 'owner') {
    return res.status(403).json({ message: 'You can only delete your own comments' });
  }
  await req.comment.deleteOne();
  res.json({ message: 'Comment deleted' });
});
