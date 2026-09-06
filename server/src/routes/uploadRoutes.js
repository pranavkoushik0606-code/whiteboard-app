import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { protect } from '../middleware/auth.js';
import { uploadImage } from '../controllers/uploadController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The stored extension is looked up here and never taken from the upload.
 *
 * `path.extname(file.originalname)` let the client pick it, and `mimetype` is
 * only the Content-Type the client wrote on the multipart part — so a file
 * called `evil.html`, declared `image/png`, was written to disk as
 * `<id>.html` and handed back by `express.static` as `text/html`. That is
 * stored XSS on the API's own origin, which is the origin every session token
 * is sent to.
 *
 * `image/jpg` is not a real media type, but it was in the old allowlist and
 * some clients send it, so it stays — mapped to the same extension as JPEG.
 */
const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EXTENSIONS[file.mimetype]}`),
});

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

export default router;
