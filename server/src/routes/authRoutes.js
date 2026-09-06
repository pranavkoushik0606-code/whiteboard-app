import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  signup,
  login,
  getMe,
  forgotPassword,
  resetPassword,
  changePassword,
  updateProfile,
  deleteMyAccount,
} from '../controllers/authController.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.put('/change-password', protect, changePassword);
router.put('/profile', protect, updateProfile);
router.delete('/account', protect, deleteMyAccount);

export default router;
