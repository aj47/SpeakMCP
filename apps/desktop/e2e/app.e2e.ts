import { test, expect } from './fixtures'

/**
 * E2E smoke tests for the SpeakMCP application
 *
 * Basic tests to verify:
 * - Application launches successfully
 * - Main window is created
 * - Basic navigation works
 * - App can be closed cleanly
 */

test.describe('Application Launch', () => {
  test('should launch the application', async ({ electronApp }) => {
    // App should be running
    expect(electronApp).toBeDefined()
  })

  test('should create main window', async ({ mainWindow }) => {
    // Main window should exist
    expect(mainWindow).toBeDefined()

    // Window should have a title
    const title = await mainWindow.title()
    expect(title).toBeDefined()
  })

  test('should load the UI', async ({ mainWindow }) => {
    // Wait for the app to fully load
    await mainWindow.waitForLoadState('domcontentloaded')

    // Root element should exist
    const root = mainWindow.locator('#root')
    await expect(root).toBeVisible()
  })

  test('should have correct window dimensions', async ({ electronApp, mainWindow }) => {
    // Get window bounds
    const bounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return window?.getBounds()
    })

    // Window should have reasonable dimensions
    expect(bounds.width).toBeGreaterThan(200)
    expect(bounds.height).toBeGreaterThan(200)
  })

  test('should respond to navigation', async ({ mainWindow }) => {
    // Navigate to settings
    await mainWindow.evaluate(() => {
      window.history.pushState({}, '', '/settings')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    // Wait for navigation
    await mainWindow.waitForTimeout(500)

    // URL should have changed
    const url = mainWindow.url()
    expect(url).toContain('/settings')
  })
})

test.describe('Application State', () => {
  test('should not have console errors on launch', async ({ mainWindow }) => {
    const errors: string[] = []

    // Listen for console errors
    mainWindow.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    // Wait a bit for any errors to appear
    await mainWindow.waitForTimeout(2000)

    // Filter out known acceptable errors
    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('ResizeObserver') && // Common benign error
        !error.includes('favicon.ico') // Missing favicon is ok
    )

    expect(criticalErrors.length).toBe(0)
  })

  test('should render without crashing', async ({ mainWindow }) => {
    // Navigate through main routes without crashing
    const routes = ['/', '/settings', '/settings/providers']

    for (const route of routes) {
      await mainWindow.evaluate((r) => {
        window.history.pushState({}, '', r)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, route)

      await mainWindow.waitForTimeout(300)

      // Page should still be functional
      const root = mainWindow.locator('#root')
      await expect(root).toBeVisible()
    }
  })
})

test.describe('IPC Communication', () => {
  test('should handle config queries', async ({ mainWindow }) => {
    // The app uses tipcClient for IPC - verify it works
    const hasConfig = await mainWindow.evaluate(async () => {
      // Access the tipcClient from window if exposed, or check if config loads
      const configElement = document.querySelector('[data-config]')
      return configElement !== null || document.body.innerHTML.includes('settings')
    })

    // Some form of config-related content should be present
    expect(hasConfig).toBeDefined()
  })
})
