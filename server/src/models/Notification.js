import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['mention', 'comment', 'invite', 'board-shared'],
      required: true,
    },
    message: { type: String, required: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Notification', notificationSchema);
