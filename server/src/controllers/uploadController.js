// @route POST /api/uploads/image
// Files are stored locally under /uploads and served statically (see index.js).
// This replaces Cloudinary so the project needs zero external accounts to run.
export const uploadImage = (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(201).json({ url });
};
