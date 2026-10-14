const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
  const instance = globalThis.__MONGO_MEMORY_SERVER__;
  if (instance && typeof instance.stop === 'function') {
    await instance.stop();
  }
  try {
    fs.unlinkSync(path.join(os.tmpdir(), 'eventease-mongo-url.txt'));
  } catch (e) {
    /* already removed */
  }
};