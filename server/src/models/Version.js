import mongoose from 'mongoose';

// Snapshot-based version history: on demand (or every N auto-saves) we store
// the full serialized canvas state so it can be restored wholesale.
const versionSchema = new mongoose.Schema(
  {
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true }, // full fabric.js JSON export
    label: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Version', versionSchema);
