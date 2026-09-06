import Board from '../models/Board.js';
import BoardMember from '../models/BoardMember.js';
import CanvasObject from '../models/CanvasObject.js';
import Comment from '../models/Comment.js';
import Favorite from '../models/Favorite.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Version from '../models/Version.js';
import { syncBoardRole } from '../socket/socketHandler.js';

/**
 * Erases a user and everything that only makes sense with them in it.
 *
 * The hard part is not the deleting, it is deciding what *survives*. A user
 * leaves traces on two kinds of board: their own, and other people's.
 *
 *   Their own boards are destroyed outright, with the same cascade
 *   `deleteBoard` uses. This does take collaborators' work with it, which is
 *   why the endpoint asks for a password first and reports the count back.
 *
 *   On other people's boards, what they drew *stays*. It belongs to the board,
 *   not to them, and tearing holes in a shared canvas is not what deleting an
 *   account should mean. Only the authorship is dropped.
 *
 * Their comments are the exception: `Comment.author` is `required`, and every
 * read populates it, so a dangling reference would come back as `author: null`
 * and take the comments panel down for everyone else on that board. They are
 * deleted rather than orphaned. Mentions of them are pulled out of the comments
 * that survive, for the same reason.
 */
export async function deleteAccount(io, userId) {
  const ownedBoards = await Board.find({ owner: userId }).select('_id').lean();
  const boardIds = ownedBoards.map((b) => b._id);

  // Anyone sitting in one of these boards is about to be looking at something
  // that no longer exists, and their next stroke would be written into nothing.
  // `board:role` with a null role is what removeMember already sends, and the
  // editor answers it by leaving for the dashboard.
  if (boardIds.length) {
    const members = await BoardMember.find({ board: { $in: boardIds } })
      .select('board user')
      .lean();
    members.forEach((m) => syncBoardRole(io, m.board, m.user, null));
  }

  const [, , , , , , comments, objects, versions] = await Promise.all([
    // --- their own boards, and everything hanging off them ---
    Board.deleteMany({ _id: { $in: boardIds } }),
    BoardMember.deleteMany({ board: { $in: boardIds } }),
    CanvasObject.deleteMany({ board: { $in: boardIds } }),
    Version.deleteMany({ board: { $in: boardIds } }),
    Comment.deleteMany({ board: { $in: boardIds } }),
    Favorite.deleteMany({ board: { $in: boardIds } }),

    // --- their traces on everyone else's boards ---
    Comment.deleteMany({ author: userId }),
    CanvasObject.updateMany({ createdBy: userId }, { $unset: { createdBy: '' } }),
    Version.updateMany({ createdBy: userId }, { $unset: { createdBy: '' } }),
  ]);

  // Second pass: these have to run after the deletions above, or they race
  // against rows that are on their way out anyway.
  await Promise.all([
    Comment.updateMany({ mentions: userId }, { $pull: { mentions: userId } }),
    BoardMember.deleteMany({ user: userId }),
    Favorite.deleteMany({ user: userId }),
    Notification.deleteMany({ user: userId }),
  ]);

  await User.deleteOne({ _id: userId });

  return {
    boardsDeleted: boardIds.length,
    commentsDeleted: comments.deletedCount,
    objectsAnonymised: objects.modifiedCount,
    versionsAnonymised: versions.modifiedCount,
  };
}
