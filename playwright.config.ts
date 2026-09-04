import { defineConfig, devices } from '@playwright/test';
import { API_URL, CLIENT_PORT, CLIENT_URL } from './e2e/config';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',

  // Collaboration tests share one board per test but one server process across
  // the run, so keep them serial — parallel workers would race on rate limits.
  fullyParallel: false,
  workers: 1,

  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: CLIENT_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // The API server and its database are started by globalSetup; this is the
  // Vite dev server only. `import.meta.env.DEV` must be true for the canvas
  // test handle, so this is `dev` rather than a preview build.
  webServer: {
    command: `npm run dev -- --port ${CLIENT_PORT} --strictPort`,
    cwd: './client',
    url: CLIENT_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      VITE_API_URL: `${API_URL}/api`,
      VITE_SOCKET_URL: API_URL,
    },
  },
});
