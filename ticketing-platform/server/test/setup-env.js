const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

// Deterministic env for tests. Set BEFORE the express app is imported so the
// config modules (dotenv, stripe, rate limit, JWT) see the right values.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-that-is-at-least-32-chars';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
process.env.PORT = '4000';
process.env.MONGODB_DATABASE = 'eventease_test';

// Neutralise anything the developer has configured so tests run deterministically.
// Empty strings (not undefined) because require('dotenv') won't override vars that
// are already present, so the values in server/.env can't leak back in.
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PUBLISHABLE_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.PYROSCOPE_SERVER_ADDRESS = '';

beforeAll(async () => {
  const uri =
    process.env.MONGODB_URI ||
    fs.readFileSync(path.join(os.tmpdir(), 'eventease-mongo-url.txt'), 'utf8');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri.replace(/\/$/, ''), {
    dbName: process.env.MONGODB_DATABASE,
  });
  // Fresh database for every test file.
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
});