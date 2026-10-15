import { defineConfig, devices } from '@playwright/test'

import { baseURL, e2eEnv } from './tests/e2e/env'

// Test workers use the same throwaway database as the server they drive.
Object.assign(process.env, e2eEnv)

/** See https://playwright.dev/docs/test-configuration. */
export default defineConfig({
  testDir: './tests/e2e',
  // One trading day is a sequence; run files one after another against one server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: { width: 1366, height: 768 },
      },
    },
  ],
  webServer: {
    command: 'node --import=tsx/esm tests/e2e/server.ts',
    url: `${baseURL}/api/health`,
    // Always start fresh: the server recreates the e2e database.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
