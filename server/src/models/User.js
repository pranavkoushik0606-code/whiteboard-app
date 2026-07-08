import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    avatarUrl: { type: String, default: '' },
    color: { type: String, default: () => randomColor() }, // used for live cursor / presence
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

function randomColor() {
  const palette = ['#F97316', '#22C55E', '#3B82F6', '#EC4899', '#A855F7', '#EAB308', '#14B8A6'];
  return palette[Math.floor(Math.random() * palette.length)];
}

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function () {
  const { _id, name, email, avatarUrl, color, theme, createdAt } = this;
  return { id: _id, name, email, avatarUrl, color, theme, createdAt };
};

export default mongoose.model('User', userSchema);
