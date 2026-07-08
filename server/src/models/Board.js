import mongoose from 'mongoose';

const boardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, default: 'Untitled Board' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    thumbnail: { type: String, default: '' },
    background: { type: String, default: '#FFFFFF' },
    gridEnabled: { type: Boolean, default: true },
    privacy: { type: String, enum: ['private', 'public', 'link'], default: 'private' },
    isFavorite: { type: Boolean, default: false },
    lastOpenedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

boardSchema.index({ owner: 1, title: 'text' });

export default mongoose.model('Board', boardSchema);
