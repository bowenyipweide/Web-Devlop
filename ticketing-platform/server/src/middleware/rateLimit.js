const rateLimit = require('express-rate-limit');

// Resolve the real client IP. Requests reach this server via the frontend
// Nginx (and, in production, Caddy) containers, so the socket address is just
// the reverse proxy — every user would share the same rate-limit bucket.
// Both proxies /append/ the original client IP as the left-most
// X-Forwarded-For entry, so that is what we key on.
const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const first = String(fwd).split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
};

// Standard API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT) || (process.env.NODE_ENV === 'production' ? 300 : 2000),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { success: false, message: 'Too many requests, please slow down.' },
});

// Strict limiter applied to ticket release / seat hold / booking endpoints.
// Backs the "smart queue" behaviour during high-demand releases.
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: {
    success: false,
    message: 'You are in our queue. Demand is high, please wait and retry.',
  },
});

module.exports = { apiLimiter, bookingLimiter };