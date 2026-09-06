import Board from '../models/Board.js';
import Favorite from '../models/Favorite.js';

/**
 * One-time move of `Board.isFavorite` onto the (user, board) pair.
 *
 * While the flag lived on the board, nobody could share a board, so the only
 * person who ever set it was the owner -- which makes the migration exact
 * rather than a guess. Runs on boot, is idempotent, and stops matching anything
 * once the field has been unset, so the steady-state cost is one indexed count.
 *
 * Uses the raw collection because `isFavorite` is no longer in the schema.
 */
export async function migrateFavorites() {
  const stale = await Board.collection
    .find({ isFavorite: true }, { projection: { owner: 1 } })
    .toArray();

  if (stale.length) {
    await Favorite.bulkWrite(
      stale.map((board) => ({
        updateOne: {
          filter: { user: board.owner, board: board._id },
          update: { $setOnInsert: { user: board.owner, board: board._id } },
          upsert: true,
        },
      }))
    );
  }

  const { modifiedCount } = await Board.collection.updateMany(
    { isFavorite: { $exists: true } },
    { $unset: { isFavorite: '' } }
  );
  return { migrated: stale.length, cleared: modifiedCount };
}
