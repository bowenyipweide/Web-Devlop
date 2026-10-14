const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 8 },
    role: {
      type: String,
      enum: ['customer', 'organizer', 'admin'],
      default: 'customer',
    },
    isApproved: { type: Boolean, default: true },
    organization: { type: String, trim: true },
    organizerBio: { type: String },
    isBanned: { type: Boolean, default: false },
    lastLogin: { type: Date },
    loyaltyPoints: { type: Number, default: 0 },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    accessibility: {
      highContrast: { type: Boolean, default: false },
      largerText: { type: Boolean, default: false },
      reducedMotion: { type: Boolean, default: false },
    },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    deviceTokens: [{ type: String }],
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// An organizer who is not yet approved (application pending) or whose access
// was revoked is treated as a regular customer everywhere: the UI, redirects,
// and tokens all reflect the effective role, while the stored role stays
// "organizer" so admins can still review/approve the account.
userSchema.methods.effectiveRole = function () {
  return this.role === 'organizer' && this.isApproved === false ? 'customer' : this.role;
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.effectiveRole(),
    pendingOrganizer: this.role === 'organizer' && this.isApproved === false,
    organization: this.organization,
    isApproved: this.isApproved,
    isBanned: this.isBanned,
    loyaltyPoints: this.loyaltyPoints,
    referralCode: this.referralCode,
    favorites: this.favorites,
    notifications: this.notifications,
    accessibility: this.accessibility,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);