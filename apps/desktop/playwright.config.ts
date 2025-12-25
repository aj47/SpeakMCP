import { defineConfig } from '@playwright/test'
import path from 'path'

/**
 * Playwright configuration for SpeakMCP E2E tests
 *
 * Tests run against the Electron app in a real browser context.
 * The app is built before tests run via the webServer.command.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron tests need single worker
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: /.*\.e2e\.ts/,
    },
  ],
  // Build the app before running E2E tests
  webServer: {
    command: 'electron-vite build',
    cwd: path.resolve(__dirname),
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
})
