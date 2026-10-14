// Boots an isolated backend for the Playwright e2e suite: a throwaway in-memory
// MongoDB, seeded fresh, plus the API on its own port.
//
// The point is that `npm run test:e2e` must never reach a developer's real
// database. server/.env points at the shared Atlas cluster, and Playwright's
// webServer used to proxy /api to whatever was already listening on port 4000 —
// so every e2e run created users, bookings and tickets in that shared database.
//
// This harness lives with the e2e suite that needs it, keeping the backend
// folder Jest-only. It still boots the real server app and seed from ../../server.
//
// Env (all optional):
//   E2E_API_PORT     port for the API          (default 4100)
//   E2E_CLIENT_URL   client origin for CORS     (default http://localhost:5199)

const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');

const PORT = Number(process.env.E2E_API_PORT || 4100);
const DB_NAME = 'eventease_e2e';

const main = async () => {
  // Set before requiring the app: config modules read process.env, and
  // dotenv will not override variables that are already present.
  // mongodb-memory-server is a backend devDependency, so resolve it from there
  // rather than duplicating the package (and its mongod download) in the client.
  const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
  const { MongoMemoryServer } = serverRequire('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DATABASE: DB_NAME,
    CLIENT_URL: process.env.E2E_CLIENT_URL || 'http://localhost:5199',
    JWT_SECRET: 'e2e-secret-key-that-is-at-least-32-chars-long',
    // Never reach real Stripe, SMTP or profiling from a test run.
    STRIPE_SECRET_KEY: '',
    STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    PYROSCOPE_SERVER_ADDRESS: '',
    // The booking/payment limiter allows 20 requests a minute per IP, which a
    // parallel e2e run shares; raise it so the suite is not rate limited.
    API_RATE_LIMIT: '100000',
  });

  console.log(`[e2e] in-memory MongoDB up (${DB_NAME})`);

  await new Promise((resolve, reject) => {
    const seed = spawn(process.execPath, [path.join(SERVER_DIR, 'src', 'seed.js')], {
      stdio: 'inherit',
      env: process.env,
    });
    seed.on('error', reject);
    seed.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`seed exited with code ${code}`))
    );
  });

  console.log('[e2e] seed complete, starting API');
  serverRequire(path.join(SERVER_DIR, 'src', 'index.js')).start();
};

const shutdown = async () => {
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[e2e] backend failed to start:', err.message);
  process.exit(1);
});
