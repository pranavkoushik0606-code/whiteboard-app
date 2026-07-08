import mongoose from 'mongoose';

const boardMemberSchema = new mongoose.Schema(
  {
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'editor', 'viewer'], default: 'editor' },
  },
  { timestamps: true }
);

boardMemberSchema.index({ board: 1, user: 1 }, { unique: true });

export default mongoose.model('BoardMember', boardMemberSchema);
