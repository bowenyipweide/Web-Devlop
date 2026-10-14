require('dotenv').config();

if (process.env.PYROSCOPE_SERVER_ADDRESS) {
  const Pyroscope = require('@pyroscope/nodejs');

  Pyroscope.init({
    serverAddress: process.env.PYROSCOPE_SERVER_ADDRESS,
    appName: process.env.OTEL_SERVICE_NAME || 'eventease-backend',
    basicAuthUser: process.env.PYROSCOPE_BASIC_AUTH_USER,
    basicAuthPassword: process.env.PYROSCOPE_BASIC_AUTH_PASSWORD,
    tags: {
      namespace: 'eventease',
      deployment_environment: process.env.NODE_ENV || 'development',
    },
    wall: {
      collectCpuTime: true,
    },
  });

  Pyroscope.start();
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { createTransporter, verifyEmailConfig } = require('./config/email');
const { setEmailAvailable } = require('./services/email.service');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const inventory = require('./services/inventory.service');
const { expirePendingBookings } = require('./controllers/booking.controller');

const app = express();

// The server is always behind the Nginx proxy container (plus Caddy in
// production), so resolve the real client IP from X-Forwarded-For. This keeps
// `req.ip` accurate for audit logs and rate limiting.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 2 : 1);

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : '*',
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe webhook needs raw body.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

app.use('/api', apiLimiter);
app.use('/api', require('./routes'));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() }));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await connectDB();
    createTransporter();
    const emailOk = await verifyEmailConfig();
    setEmailAvailable(emailOk);
    // Release expired seat holds and cancel their pending bookings periodically
    // (durable fallback for the per-booking in-memory hold timers).
    setInterval(() => {
      inventory.releaseExpiredHolds().catch(() => {});
      expirePendingBookings().catch(() => {});
    }, 30 * 1000);

    app.listen(PORT, () => console.log(`[server] EventEase API running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
};

if (require.main === module) start();

module.exports = { app, start };
