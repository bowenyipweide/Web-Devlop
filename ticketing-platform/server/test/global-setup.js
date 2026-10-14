const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
  // A single in-memory MongoDB shared by every test file (jest runInBand).
  // The URI is handed to each worker through a temp file because globalSetup
  // runs in a separate context from the test worker processes.
  const instance = await MongoMemoryServer.create();
  const uri = instance.getUri();
  process.env.MONGODB_URI = uri;
  globalThis.__MONGO_MEMORY_SERVER__ = instance;

  fs.writeFileSync(
    path.join(os.tmpdir(), 'eventease-mongo-url.txt'),
    uri,
    'utf8'
  );
};