// @route POST /api/uploads/image
// Files are stored locally under /uploads and served statically (see index.js).
// This replaces Cloudinary so the project needs zero external accounts to run.
export const uploadImage = (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

  const filePath = `/uploads/${req.file.filename}`;
  // `req.get('host')` is a client-supplied header, and this URL does not stay
  // between us: it is written into the Fabric object's `src` and then loaded by
  // every other member of the board. PUBLIC_URL pins it when set. Clients are
  // better off ignoring `url` entirely and resolving `path` against the API
  // origin they already know — which is what ours does.
  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(
    /\/+$/,
    ''
  );
  res.status(201).json({ url: `${origin}${filePath}`, path: filePath });
};
