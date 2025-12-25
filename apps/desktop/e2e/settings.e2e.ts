import { test, expect, navigateTo, navigateToSettings } from './fixtures'

/**
 * E2E tests for settings configuration
 *
 * Tests the settings pages functionality:
 * - General settings (theme, launch at login, shortcuts)
 * - Provider settings (API keys, model selection)
 * - Persistence of settings changes
 */

test.describe('Settings - General', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateToSettings(mainWindow, 'general')
  })

  test('should display general settings page', async ({ mainWindow }) => {
    // Check that general settings content is visible
    await expect(mainWindow.getByText(/general|settings/i).first()).toBeVisible()

    // Should show app settings section
    await expect(mainWindow.getByText(/app|appearance/i).first()).toBeVisible()
  })

  test('should have theme selector', async ({ mainWindow }) => {
    // Look for theme setting
    await expect(mainWindow.getByText(/theme/i)).toBeVisible()

    // Should have theme options (system, light, dark)
    const themeSelector = mainWindow.locator('[role="combobox"]').first()
    if (await themeSelector.isVisible()) {
      await themeSelector.click()

      // Check for theme options
      await expect(mainWindow.getByRole('option', { name: /system/i })).toBeVisible()
      await expect(mainWindow.getByRole('option', { name: /light/i })).toBeVisible()
      await expect(mainWindow.getByRole('option', { name: /dark/i })).toBeVisible()
    }
  })

  test('should toggle launch at login setting', async ({ mainWindow }) => {
    // Find the "Launch at Login" switch
    const launchAtLoginLabel = mainWindow.getByText(/launch at login/i)
    await expect(launchAtLoginLabel).toBeVisible()

    // Find the switch associated with this setting
    const switchElement = mainWindow.locator('[role="switch"]').first()
    if (await switchElement.isVisible()) {
      const initialState = await switchElement.getAttribute('aria-checked')

      // Toggle the switch
      await switchElement.click()

      // Verify state changed
      const newState = await switchElement.getAttribute('aria-checked')
      expect(newState).not.toBe(initialState)
    }
  })

  test('should display shortcut settings', async ({ mainWindow }) => {
    // Should show shortcut configuration
    await expect(mainWindow.getByText(/shortcut|recording/i).first()).toBeVisible()
  })
})

test.describe('Settings - Providers', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateToSettings(mainWindow, 'providers')
  })

  test('should display provider settings page', async ({ mainWindow }) => {
    // Should show provider configuration
    await expect(mainWindow.getByText(/provider|api/i).first()).toBeVisible()
  })

  test('should have API key input fields', async ({ mainWindow }) => {
    // Look for API key inputs (OpenAI, Groq, Gemini)
    const apiKeyInputs = mainWindow.locator('input[type="password"], input[type="text"]')

    // Should have at least one API key input
    const count = await apiKeyInputs.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should allow entering API keys', async ({ mainWindow }) => {
    // Find a visible API key input
    const apiKeyInput = mainWindow.locator('input[type="password"]').first()

    if (await apiKeyInput.isVisible()) {
      await apiKeyInput.fill('sk-test-key-12345')

      // Verify the value was entered (check that input is not empty)
      await expect(apiKeyInput).not.toHaveValue('')
    }
  })
})

test.describe('Settings - Navigation', () => {
  test('should navigate between settings sections', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings')

    // Should be on general settings by default
    await expect(mainWindow).toHaveURL(/\/settings|\/settings\/general/)

    // Look for navigation links to other settings sections
    const providersLink = mainWindow.getByRole('link', { name: /provider/i })
    if (await providersLink.isVisible()) {
      await providersLink.click()
      await expect(mainWindow).toHaveURL(/\/settings\/providers/)
    }

    const toolsLink = mainWindow.getByRole('link', { name: /tools/i })
    if (await toolsLink.isVisible()) {
      await toolsLink.click()
      await expect(mainWindow).toHaveURL(/\/settings\/(tools|mcp-tools)/)
    }
  })

  test('should preserve settings when navigating away and back', async ({ mainWindow }) => {
    await navigateToSettings(mainWindow, 'general')

    // Change a setting (theme)
    const themeSelector = mainWindow.locator('[role="combobox"]').first()
    if (await themeSelector.isVisible()) {
      await themeSelector.click()
      await mainWindow.getByRole('option', { name: /dark/i }).click()

      // Navigate away
      await navigateTo(mainWindow, '/')
      await mainWindow.waitForTimeout(500)

      // Navigate back
      await navigateToSettings(mainWindow, 'general')
      await mainWindow.waitForTimeout(500)

      // Check that setting was preserved
      await expect(themeSelector).toContainText(/dark/i)
    }
  })
})

test.describe('Settings - Remote Server', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateToSettings(mainWindow, 'remote-server')
  })

  test('should display remote server settings', async ({ mainWindow }) => {
    // Should show remote server configuration
    await expect(mainWindow.getByText(/remote|server|tunnel/i).first()).toBeVisible()
  })

  test('should have server enable/disable toggle', async ({ mainWindow }) => {
    // Look for a switch to enable/disable remote server
    const switchElement = mainWindow.locator('[role="switch"]').first()
    await expect(switchElement).toBeVisible()
  })
})
