import mongoose from 'mongoose';

// Stores one Fabric.js object per document. `data` holds the raw Fabric JSON
// (shape/stroke/fill/position/etc.) so the client can rehydrate the canvas
// by fetching all objects for a board and calling fabric.util.enlivenObjects.
const canvasObjectSchema = new mongoose.Schema(
  {
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    objectId: { type: String, required: true }, // client-generated uuid, stable across updates
    type: { type: String, required: true }, // rect, circle, path, textbox, sticky-note, image, etc.
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    zIndex: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

canvasObjectSchema.index({ board: 1, objectId: 1 }, { unique: true });

export default mongoose.model('CanvasObject', canvasObjectSchema);
