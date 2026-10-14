import { defineConfig, devices } from '@playwright/test';

// Deliberately not 5173/4000: reusing those ports would silently run the suite
// against a developer's running dev server, and therefore against the real
// database in server/.env. These are dedicated to the test run and are thrown
// away afterwards — the backend is an in-memory MongoDB seeded per run.
const API_PORT = Number(process.env.E2E_API_PORT || 4100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5199);
const API_URL = `http://localhost:${API_PORT}`;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporters: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'node e2e/backend.cjs',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 180000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { E2E_API_PORT: String(API_PORT), E2E_CLIENT_URL: BASE_URL },
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { API_PROXY_TARGET: API_URL },
    },
  ],
});
