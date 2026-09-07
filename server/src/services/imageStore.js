import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
/**
 * Why a bad CLOUDINARY_URL must not reach the SDK.
 *
 * The SDK parses the variable when its module is *imported*, not when it is
 * used, and throws on anything that does not begin `cloudinary://`. Importing
 * it at the top of this file therefore meant one mistyped environment variable
 * crashed the whole API at boot -- auth, boards, sockets, all of it -- over a
 * setting that only affects image uploads. A deploy failed exactly that way.
 *
 * The likeliest mistake is not a typo. Cloudinary's dashboard shows the value
 * as `CLOUDINARY_URL=cloudinary://...`, and pasting the whole line is the
 * obvious thing to do, so it gets its own message.
 */
export function cloudinaryUrlProblem() {
  const raw = process.env.CLOUDINARY_URL;
  if (raw === undefined || raw.trim() === '') return null;

  const value = raw.trim();
  if (value.startsWith('CLOUDINARY_URL=')) {
    return 'CLOUDINARY_URL includes the variable name. Set the value to just the part starting cloudinary://';
  }
  if (!value.startsWith('cloudinary://')) {
    return `CLOUDINARY_URL must start with cloudinary:// (got ${value.slice(0, 12)}...)`;
  }
  return null;
}

export function usingCloudinary() {
  if (process.env.CLOUDINARY_URL) return !cloudinaryUrlProblem();
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

async function configureCloudinary() {
  // Imported here rather than at the top of the file so that a malformed
  // CLOUDINARY_URL can only fail an upload, never the process. See above.
  const { v2: cloudinary } = await import('cloudinary');

  if (process.env.CLOUDINARY_URL) {
    // Trailing whitespace survives a dashboard paste and the SDK does not trim.
    process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL.trim();
  } else {
    // The split form is not read from the environment by the SDK.
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
  cloudinary.config({ secure: true });
  return cloudinary;
}

async function uploadToCloudinary(buffer) {
  const cloudinary = await configureCloudinary();
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
