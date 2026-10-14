module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.js',
  globalTeardown: '<rootDir>/test/global-teardown.js',
  setupFilesAfterEnv: ['<rootDir>/test/setup-env.js'],
  testMatch: ['<rootDir>/test/**/*.test.js'],
  // Bookings schedule a 10-minute seat-hold timeout (src/controllers/booking.controller.js)
  // which keeps Node alive after the last test; force-exit so the run completes.
  forceExit: true,
};