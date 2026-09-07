import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.join(__dirname, '../../uploads');

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The stored extension is looked up here and never taken from the upload.
 *
 * `path.extname(file.originalname)` let the client pick it, and `mimetype` is
 * only the Content-Type the client wrote on the multipart part — so a file
 * called `evil.html`, declared `image/png`, was written to disk as `<id>.html`
 * and handed back by `express.static` as `text/html`. That is stored XSS on the
 * API's own origin, which is the origin every session token is sent to.
 *
 * `image/jpg` is not a real media type, but some clients send it, so it stays —
 * mapped to the same extension as JPEG.
 */
export const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * Cloudinary is used when it is configured and the local disk otherwise.
 *
 * The disk is not a fallback in the sense of "nearly as good". On Render's free
 * tier it is ephemeral *and* the service spins down after about fifteen minutes
 * of no traffic, so every upload is gone within the hour: the Fabric object
 * survives in Mongo and its `src` starts 404ing. It exists so the project still
 * runs, and the test suite still passes, with no external account at all.
 *
 * Read at call time rather than at import. The tests need to flip it, and a
 * module-level constant would freeze whatever the environment looked like when
 * the first import happened.
 */
export function usingCloudinary() {
  return Boolean(
    process.env.CLOUDINARY_URL ||
      (process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET)
  );
}

function configureCloudinary() {
  // CLOUDINARY_URL is read by the SDK on its own; the split form is not.
  if (!process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
  cloudinary.config({ secure: true });
}

function uploadToCloudinary(buffer) {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: process.env.CLOUDINARY_FOLDER || 'whiteboard',
        // Cloudinary decodes the bytes and rejects anything that is not an
        // image. That is a real check, unlike the mimetype on the multipart
        // part, which is whatever the client typed.
        resource_type: 'image',
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

async function writeToDisk(buffer, mimetype) {
  await fsp.mkdir(uploadsDir, { recursive: true });
  const filename = `${crypto.randomUUID()}${EXTENSIONS[mimetype]}`;
  await fsp.writeFile(path.join(uploadsDir, filename), buffer);
  return { path: `/uploads/${filename}` };
}

/**
 * Returns `{ url }` for a remote store and `{ path }` for the local one.
 *
 * The shapes are different on purpose. A local file has no absolute URL until
 * someone decides which origin to serve it from, and that decision needs the
 * request; a Cloudinary asset already has one and must not be rewritten. The
 * client resolves `path` against the API origin it already knows and otherwise
 * uses `url` verbatim, so it does not need to know which store is in use.
 */
export async function storeImage(buffer, mimetype) {
  if (!usingCloudinary()) return writeToDisk(buffer, mimetype);
  const result = await uploadToCloudinary(buffer);
  return { url: result.secure_url, publicId: result.public_id };
}

export const uploadsDirExists = () => fs.existsSync(uploadsDir);
