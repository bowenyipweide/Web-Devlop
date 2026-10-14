const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const { signToken } = require('../middleware/auth');
const { generateQrDataUrl } = require('../utils/qr');
const { audit } = require('../utils/audit');

const makeReferralCode = (name) => {
  const stem = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `R${stem}${suffix}`;
};

// Shared password policy: at least 8 characters, with an uppercase letter and a
// symbol. Returns a human-readable problem, or null when the password is fine.
const PASSWORD_MIN_LENGTH = 8;
const validatePassword = (password) => {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain at least one symbol';
  return null;
};

// Referral signup bonus: both the referrer and the newly referred user earn
// this many loyalty points.
const REFERRAL_BONUS_POINTS = 500;

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role = 'customer', organization, referralCode, accessibility } = req.body;

  if (!name || !email || !password) throw ApiError.badRequest('Name, email and password are required');
  const passwordProblem = validatePassword(password);
  if (passwordProblem) throw ApiError.badRequest(passwordProblem);

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw ApiError.conflict('Email already registered');

  let referredBy = null;
  if (referralCode) {
    referredBy = await User.findOne({ referralCode: referralCode.toUpperCase() });
    if (!referredBy) throw ApiError.badRequest('Invalid referral code');
  }

  const userFields = {
    name,
    email,
    password,
    role: ['customer', 'organizer'].includes(role) ? role : 'customer',
    organization,
    isApproved: role === 'organizer' ? false : true,
    referredBy: referredBy ? referredBy._id : undefined,
    accessibility: accessibility || {},
    // Credited at creation so the signup response already reflects the bonus.
    loyaltyPoints: referredBy ? REFERRAL_BONUS_POINTS : 0,
  };

  // referralCode ends in a short random suffix, so it can in principle collide
  // on its unique index. Retry with a fresh code instead of failing signup.
  let user;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      user = await User.create({ ...userFields, referralCode: makeReferralCode(name) });
      break;
    } catch (err) {
      const clash = err.code === 11000 && err.keyValue && 'referralCode' in err.keyValue;
      if (!clash || attempt === 4) throw err;
    }
  }

  if (referredBy) {
    // Both sides of the referral earn loyalty points; the referred user's share
    // was already written above as part of their user record.
    await User.updateOne(
      { _id: referredBy._id },
      { $inc: { loyaltyPoints: REFERRAL_BONUS_POINTS } }
    );
  }

  await audit(req, { action: 'register', targetType: 'User', targetId: user._id });

  const token = signToken(user);
  ok(res, { token, user: user.toSafeJSON() }, 201);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw ApiError.badRequest('Email and password required');

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw ApiError.unauthorized('Invalid credentials');

  if (user.isBanned) throw ApiError.forbidden('This account has been banned');
  if (user.lockedUntil && user.lockedUntil > new Date())
    throw ApiError.tooMany('Too many failed attempts. Try again later.');

  const match = await user.comparePassword(password);
  if (!match) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const update = { failedLoginAttempts: attempts };
    if (attempts >= 5) update.lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    await User.updateOne({ _id: user._id }, update);
    throw ApiError.unauthorized('Invalid credentials');
  }

  await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockedUntil: null, lastLogin: new Date() });
  const token = signToken(user);
  const fresh = await User.findById(user._id);
  ok(res, { token, user: fresh.toSafeJSON() });
});

const me = asyncHandler(async (req, res) => {
  ok(res, { user: req.user.toSafeJSON() });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw ApiError.badRequest('Current and new password are required');
  const passwordProblem = validatePassword(newPassword);
  if (passwordProblem) throw ApiError.badRequest(passwordProblem);

  const user = await User.findById(req.user._id);
  if (!user) throw ApiError.notFound('User not found');

  const match = await user.comparePassword(currentPassword);
  if (!match) throw ApiError.unauthorized('Current password is incorrect');

  if (await user.comparePassword(newPassword))
    throw ApiError.badRequest('New password must be different from the current password');

  user.password = newPassword;
  await user.save();

  await audit(req, { action: 'auth.changePassword', targetType: 'User', targetId: user._id });
  ok(res, { message: 'Password updated successfully.' });
});

module.exports = { register, login, me, changePassword };