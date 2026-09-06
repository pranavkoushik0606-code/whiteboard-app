import mongoose from 'mongoose';

/**
 * A favourite is a property of the (user, board) pair, not of the board.
 *
 * It used to be a boolean on the Board document, which was invisible while
 * nobody could share a board — the owner was the only person who ever saw it.
 * The moment sharing has a UI, one member starring a board would star it for
 * everyone, so it moved here.
 */
const favoriteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
  },
  { timestamps: true }
);

favoriteSchema.index({ user: 1, board: 1 }, { unique: true });

export default mongoose.model('Favorite', favoriteSchema);
