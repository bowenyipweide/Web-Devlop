const ApiError = require('../utils/ApiError');

const notFound = (req, res, next) => next(ApiError.notFound(`Route ${req.originalUrl} not found`));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode = 500, message } = err;

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }
  if (err.code === 11000) {
    statusCode = 409;
    message = `Duplicate value for ${Object.keys(err.keyValue || {}).join(', ')}`;
  }
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid id format';
  }
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }
  if (err.type === 'StripeCardError' || err.type === 'StripeInvalidRequestError') {
    statusCode = 400;
    message = err.message;
  }

  if (!err.isOperational) console.error('[error]', err);

  res.status(statusCode).json({ success: false, message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
};

module.exports = { notFound, errorHandler };