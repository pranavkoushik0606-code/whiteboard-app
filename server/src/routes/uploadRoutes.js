import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/auth.js';
import { diagnoseStore, uploadImage } from '../controllers/uploadController.js';
import { EXTENSIONS, MAX_IMAGE_BYTES } from '../services/imageStore.js';

export { MAX_IMAGE_BYTES };

/**
 * Memory, not disk. Where the bytes end up is the store's decision now — see
 * services/imageStore.js — and a Cloudinary upload has no local file to move
 * or clean up. The 10 MB cap below is what keeps this from being a way to
 * spend the process's memory.
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!EXTENSIONS[file.mimetype]) {
    return cb(new Error('Only PNG, JPEG, GIF and WebP images are allowed'));
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_IMAGE_BYTES } });

/**
 * Multer reports a rejected type and an oversized file by calling `next(err)`,
 * which reached the generic handler as a `500`. "Your image is too big" and
 * "the server fell over" are different answers and the client has to be able
 * to tell them apart without parsing prose.
 */
const receiveImage = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(413)
        .json({ message: `Image must be under ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` });
    }
    res.status(400).json({ message: err.message });
  });

const router = express.Router();
router.post('/image', protect, receiveImage, uploadImage);
router.get('/diagnose', protect, diagnoseStore);

export default router;
