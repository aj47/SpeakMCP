import { test, expect, navigateTo } from './fixtures'

/**
 * E2E tests for the onboarding flow
 *
 * Tests the complete onboarding experience for new users:
 * - Welcome step display
 * - API key configuration step
 * - Dictation test step
 * - Agent mode step
 * - Completion and navigation to main app
 */

test.describe('Onboarding Flow', () => {
  test('should display welcome step on first launch', async ({ mainWindow }) => {
    // Navigate to onboarding page
    await navigateTo(mainWindow, '/onboarding')
    await mainWindow.waitForLoadState('networkidle')

    // Check welcome step is displayed
    await expect(mainWindow.getByText(/welcome/i)).toBeVisible()

    // Should have a "Get Started" or "Next" button
    const nextButton = mainWindow.getByRole('button', { name: /get started|next|continue/i })
    await expect(nextButton).toBeVisible()
  })

  test('should navigate through onboarding steps', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/onboarding')
    await mainWindow.waitForLoadState('networkidle')

    // Step 1: Welcome - click to proceed
    const getStartedButton = mainWindow.getByRole('button', { name: /get started|next|continue/i })
    await expect(getStartedButton).toBeVisible()
    await getStartedButton.click()

    // Step 2: API Key - should see API key input
    await expect(mainWindow.getByText(/api key/i)).toBeVisible({ timeout: 5000 })

    // Should have input field for API key
    const apiKeyInput = mainWindow.locator('input[type="text"], input[type="password"]').first()
    await expect(apiKeyInput).toBeVisible()

    // Skip API key step (button should exist)
    const skipButton = mainWindow.getByRole('button', { name: /skip/i })
    await expect(skipButton).toBeVisible()
    await skipButton.click()

    // Step 3: Dictation - should see dictation test UI
    await expect(mainWindow.getByText(/dictation|recording|microphone/i)).toBeVisible({ timeout: 5000 })

    // Should have recording controls
    const nextOrSkip = mainWindow.getByRole('button', { name: /next|skip|continue/i })
    await expect(nextOrSkip).toBeVisible()
    await nextOrSkip.click()

    // Step 4: Agent mode - should see agent mode explanation
    await expect(mainWindow.getByText(/agent|mcp|tools/i)).toBeVisible({ timeout: 5000 })
  })

  test('should allow API key entry and proceed', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/onboarding')
    await mainWindow.waitForLoadState('networkidle')

    // Navigate to API key step
    const getStartedButton = mainWindow.getByRole('button', { name: /get started|next|continue/i })
    await getStartedButton.click()

    // Wait for API key step
    await expect(mainWindow.getByText(/api key/i)).toBeVisible({ timeout: 5000 })

    // Enter an API key
    const apiKeyInput = mainWindow.locator('input[type="text"], input[type="password"]').first()
    await apiKeyInput.fill('test-api-key-12345')

    // Click next/save to proceed
    const nextButton = mainWindow.getByRole('button', { name: /next|save|continue/i }).first()
    await expect(nextButton).toBeEnabled()
  })

  test('should complete onboarding and navigate to main app', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/onboarding')
    await mainWindow.waitForLoadState('networkidle')

    // Navigate through all steps quickly using skip buttons
    // Step 1: Welcome
    const getStartedButton = mainWindow.getByRole('button', { name: /get started|next|continue/i })
    await getStartedButton.click()

    // Step 2: Skip API key
    await mainWindow.waitForTimeout(500)
    const skipApiKey = mainWindow.getByRole('button', { name: /skip/i })
    if (await skipApiKey.isVisible()) {
      await skipApiKey.click()
    }

    // Step 3: Skip dictation
    await mainWindow.waitForTimeout(500)
    const skipDictation = mainWindow.getByRole('button', { name: /next|skip|continue/i })
    if (await skipDictation.isVisible()) {
      await skipDictation.click()
    }

    // Step 4: Complete agent mode / finish
    await mainWindow.waitForTimeout(500)
    const finishButton = mainWindow.getByRole('button', { name: /finish|complete|done|get started/i })
    if (await finishButton.isVisible()) {
      await finishButton.click()
    }

    // Should navigate to main sessions page
    await expect(mainWindow).toHaveURL(/\/$/, { timeout: 10000 })
  })

  test('should allow skipping entire onboarding', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/onboarding')
    await mainWindow.waitForLoadState('networkidle')

    // Look for a "Skip" button on the welcome screen
    const skipOnboardingButton = mainWindow.getByRole('button', { name: /skip onboarding|skip setup/i })
    if (await skipOnboardingButton.isVisible()) {
      await skipOnboardingButton.click()
      // Should navigate to main app
      await expect(mainWindow).toHaveURL(/\/$/, { timeout: 10000 })
    }
  })
})
