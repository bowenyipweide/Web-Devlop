const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const signToken = (user) =>
  jwt.sign(
    { id: user._id, role: user.role === 'organizer' && user.isApproved === false ? 'customer' : user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

const protect = async (req, res, next) => {
  try {
    let token;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) token = header.slice(7);
    if (!token) throw ApiError.unauthorized('Not authenticated');

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (user.isBanned) throw ApiError.forbidden('Account banned');

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err instanceof ApiError ? err : ApiError.unauthorized('Invalid token'));
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      req.user = await User.findById(payload.id);
    }
  } catch (e) {
    /* noop */
  }
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Not authenticated'));
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Forbidden'));
  if (req.user.role === 'organizer' && req.user.isApproved === false)
    return next(ApiError.forbidden('Organizer not approved yet'));
  next();
};

module.exports = { signToken, protect, optionalAuth, requireRole };