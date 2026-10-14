const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

module.exports = { asyncHandler, ok };