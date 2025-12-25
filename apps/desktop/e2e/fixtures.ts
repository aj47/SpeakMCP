import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

/**
 * Custom test fixtures for SpeakMCP Electron E2E tests
 *
 * Provides:
 * - electronApp: The launched Electron application
 * - mainWindow: The main BrowserWindow's page
 * - configDir: Temporary config directory for isolated tests
 */

export interface ElectronFixtures {
  electronApp: ElectronApplication
  mainWindow: Page
  configDir: string
}

// Path to the built Electron app
const appPath = path.resolve(__dirname, '../out/main/index.js')

export const test = base.extend<ElectronFixtures>({
  // Create a temporary config directory for test isolation
  configDir: async ({}, use) => {
    const configDir = path.join(os.tmpdir(), `speakmcp-e2e-${Date.now()}`)
    fs.mkdirSync(configDir, { recursive: true })
    await use(configDir)
    // Cleanup after test
    fs.rmSync(configDir, { recursive: true, force: true })
  },

  // Launch the Electron application
  electronApp: async ({ configDir }, use) => {
    // Set environment variables for test isolation
    const env = {
      ...process.env,
      SPEAKMCP_CONFIG_DIR: configDir,
      NODE_ENV: 'test',
      // Disable analytics/telemetry in tests
      SPEAKMCP_DISABLE_ANALYTICS: '1',
    }

    const electronApp = await electron.launch({
      args: [appPath],
      env,
    })

    await use(electronApp)
    await electronApp.close()
  },

  // Get the main window page
  mainWindow: async ({ electronApp }, use) => {
    // Wait for the first BrowserWindow to open
    const window = await electronApp.firstWindow()

    // Wait for the app to be fully loaded
    await window.waitForLoadState('domcontentloaded')

    await use(window)
  },
})

export { expect } from '@playwright/test'

/**
 * Helper to wait for navigation within the Electron app
 */
export async function waitForRoute(page: Page, route: string, timeout = 10000) {
  await page.waitForFunction(
    (expectedRoute) => window.location.pathname === expectedRoute,
    route,
    { timeout }
  )
}

/**
 * Helper to check if a toast notification appears
 */
export async function waitForToast(page: Page, message: string | RegExp, timeout = 5000) {
  const toastSelector = '[data-sonner-toast]'
  await page.waitForSelector(toastSelector, { timeout })
  const toast = page.locator(toastSelector).first()
  if (typeof message === 'string') {
    await expect(toast).toContainText(message, { timeout })
  } else {
    await expect(toast).toHaveText(message, { timeout })
  }
  return toast
}

/**
 * Helper to navigate to a settings page
 */
export async function navigateToSettings(page: Page, section?: string) {
  const path = section ? `/settings/${section}` : '/settings'
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForLoadState('networkidle')
}

/**
 * Helper to navigate to a specific route
 */
export async function navigateTo(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForLoadState('networkidle')
}
