import { storeImage, usingCloudinary } from '../services/imageStore.js';

// @route POST /api/uploads/image
//
// Cloudinary when configured, the local disk otherwise. The disk is only there
// so the project runs with no external account: on Render's free tier it is
// ephemeral and the service sleeps after ~15 minutes idle, so uploads do not
// outlive the day. See services/imageStore.js.
export const uploadImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

  let stored;
  try {
    stored = await storeImage(req.file.buffer, req.file.mimetype);
  } catch (err) {
    // A 500 here would read as "the app is broken" when the truth is that a
    // third party would not take the file. The client shows this text.
    console.error('[uploads] image store failed:', err?.message || err);
    return res.status(502).json({
      message: usingCloudinary()
        ? 'The image service would not accept that file. Try again in a moment.'
        : 'That image could not be saved.',
    });
  }

  // Already absolute and on someone else's origin — must not be rewritten.
  if (stored.url) return res.status(201).json({ url: stored.url });

  // A local file has no absolute URL until someone picks an origin, and
  // `req.get('host')` is a client-supplied header. This URL does not stay
  // between us: it is written into the Fabric object's `src` and loaded by
  // every other member of the board. PUBLIC_URL pins it when set. Clients are
  // better off resolving `path` against the API origin they already know —
  // which is what ours does.
  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(
    /\/+$/,
    ''
  );
  res.status(201).json({ url: `${origin}${stored.path}`, path: stored.path });
};
