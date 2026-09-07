import crypto from 'crypto';
import validator from 'validator';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateToken } from '../utils/generateToken.js';
import { sendEmail } from '../utils/sendEmail.js';
import { deleteAccount } from '../services/accountDeletion.js';

// @route POST /api/auth/signup
export const signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }
  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email address' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ message: 'Email already registered' });

  const user = await User.create({ name, email, password });
  res.status(201).json({ user: user.toSafeObject(), token: generateToken(user._id) });
});

// @route POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  res.json({ user: user.toSafeObject(), token: generateToken(user._id) });
});

// @route GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeObject() });
});

// @route POST /api/auth/forgot-password
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  // Always respond the same way whether or not the user exists, to avoid leaking account existence
  if (!user) return res.json({ message: 'If that email exists, a reset link has been sent' });

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;
  const { previewUrl } = await sendEmail({
    to: user.email,
    subject: 'Reset your Whiteboard password',
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`,
  });

  res.json({
    message: 'If that email exists, a reset link has been sent',
    // Exposed here only because we're using Ethereal's fake inbox in dev —
    // remove this field once you wire up a real email provider.
    devPreviewUrl: previewUrl,
  });
});

// @route POST /api/auth/reset-password/:token
export const resetPassword = asyncHandler(async (req, res) => {
  const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: Date.now() },
  });
  if (!user) return res.status(400).json({ message: 'Token is invalid or has expired' });

  // Same rule signup enforces. Without this the only check is Mongoose's on
  // save, which surfaces as a 500 rather than a validation error.
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: 'Password reset successful', token: generateToken(user._id) });
});

// @route PUT /api/auth/change-password
export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  const { currentPassword, newPassword } = req.body;
  if (!(await user.comparePassword(currentPassword))) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }
  user.password = newPassword;
  await user.save();
  res.json({ message: 'Password updated' });
});

// @route PUT /api/auth/profile
export const updateProfile = asyncHandler(async (req, res) => {
  const { name, theme, avatarUrl } = req.body;
  if (name) req.user.name = name;
  if (theme) req.user.theme = theme;
  if (avatarUrl) req.user.avatarUrl = avatarUrl;
  await req.user.save();
  res.json({ user: req.user.toSafeObject() });
});

// @route DELETE /api/auth/account
/**
 * The password is required even though the caller already holds a valid token.
 * This is the one endpoint that destroys data it cannot put back, and a token
 * lives in localStorage for seven days — re-authenticating is what stops a
 * stolen one from being an erase button.
 */
export const deleteMyAccount = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: 'Your password is required to delete your account' });
  }

  // req.user comes from `protect`, which does not select the password.
  const user = await User.findById(req.user._id).select('+password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  // 400, not the 401 a failed credential would normally get: the client's axios
  // interceptor treats every 401 as an expired session and bounces to /login, so
  // a 401 here would log you out instead of telling you that you typed your
  // password wrong. `changePassword` answers 400 for the same reason.
  if (!(await user.comparePassword(password))) {
    return res.status(400).json({ message: 'Incorrect password' });
  }

  const summary = await deleteAccount(req.app.get('io'), user._id);
  res.json({ message: 'Account deleted', ...summary });
});
