import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';
import Notification from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();
router.use(protect);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [notifications, unread] = await Promise.all([
      Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      // Counted separately: the list is capped at 50, so counting the page
      // would quietly under-report anyone with a real backlog.
      Notification.countDocuments({ user: req.user._id, read: false }),
    ]);
    res.json({ notifications, unread });
  })
);

// Ahead of /:id/read so "read-all" is never parsed as an id.
router.put(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { modifiedCount } = await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true }
    );
    res.json({ read: modifiedCount });
  })
);

router.put(
  '/:id/read',
  asyncHandler(async (req, res) => {
    // A malformed id used to reach Mongoose and come back as a 500.
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );
    // Scoping to req.user means someone else's id is a miss, not a 403 — but it
    // used to answer 200 with `notification: null` either way.
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json({ notification });
  })
);

export default router;
