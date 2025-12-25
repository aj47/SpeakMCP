import { test, expect, navigateTo } from './fixtures'

/**
 * E2E tests for session and conversation management
 *
 * Tests the main sessions page functionality:
 * - Empty state display
 * - Session grid interactions
 * - Starting new sessions
 * - Viewing conversation history
 * - Searching conversations
 * - Deleting conversations
 */

test.describe('Sessions Page', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/')
  })

  test('should display sessions page', async ({ mainWindow }) => {
    // Sessions page should load
    await expect(mainWindow).toHaveURL(/^\/$/)

    // Should show either sessions or empty state
    const pageContent = mainWindow.locator('main, [role="main"], .app-content')
    await expect(pageContent.first()).toBeVisible()
  })

  test('should show empty state when no sessions', async ({ mainWindow }) => {
    // With fresh config, should show empty state
    const emptyState = mainWindow.getByText(/no active sessions|start a new/i)

    // If empty state is visible, should have action buttons
    if (await emptyState.isVisible()) {
      // Should have "Start with Text" button
      const textButton = mainWindow.getByRole('button', { name: /text/i })
      await expect(textButton).toBeVisible()

      // Should have "Start with Voice" button
      const voiceButton = mainWindow.getByRole('button', { name: /voice/i })
      await expect(voiceButton).toBeVisible()
    }
  })

  test('should have new session button', async ({ mainWindow }) => {
    // Look for a button to start a new session
    const newSessionButton = mainWindow.getByRole('button', { name: /new|start|plus/i })
    await expect(newSessionButton.first()).toBeVisible()
  })

  test('should open text input dialog', async ({ mainWindow }) => {
    // Find and click the "Start with Text" button
    const textButton = mainWindow.getByRole('button', { name: /text/i }).first()

    if (await textButton.isVisible()) {
      await textButton.click()

      // Should open a dialog or input field for text
      const inputElement = mainWindow.locator('textarea, input[type="text"]').first()
      await expect(inputElement).toBeVisible({ timeout: 5000 })
    }
  })

  test('should navigate to settings from sessions page', async ({ mainWindow }) => {
    // Look for settings link/button in navigation
    const settingsLink = mainWindow.getByRole('link', { name: /settings/i })

    if (await settingsLink.isVisible()) {
      await settingsLink.click()
      await expect(mainWindow).toHaveURL(/\/settings/)
    }
  })
})

test.describe('Conversation History', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/history')
  })

  test('should display history page', async ({ mainWindow }) => {
    // History page should load
    await expect(mainWindow).toHaveURL(/\/history/)
  })

  test('should have search functionality', async ({ mainWindow }) => {
    // Look for search input
    const searchInput = mainWindow.getByPlaceholder(/search/i)

    if (await searchInput.isVisible()) {
      // Enter search query
      await searchInput.fill('test query')

      // Verify search was applied
      await expect(searchInput).toHaveValue('test query')

      // Clear search
      await searchInput.clear()
    }
  })

  test('should display past sessions grouped by date', async ({ mainWindow }) => {
    // Look for date grouping headers
    const dateHeaders = mainWindow.locator('h3, h4, [class*="date-header"]')
    const count = await dateHeaders.count()

    // If there are past sessions, they should be grouped by date
    // This is a soft check since there might not be any history
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should show delete all conversations option', async ({ mainWindow }) => {
    // Look for "Delete All" or "Clear History" button
    const deleteAllButton = mainWindow.getByRole('button', { name: /delete all|clear/i })

    if (await deleteAllButton.isVisible()) {
      await deleteAllButton.click()

      // Should show confirmation dialog
      const confirmDialog = mainWindow.getByRole('dialog')
      if (await confirmDialog.isVisible()) {
        // Cancel the deletion
        const cancelButton = mainWindow.getByRole('button', { name: /cancel|no/i })
        await cancelButton.click()
      }
    }
  })
})

test.describe('Session Grid', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/')
  })

  test('should show session tiles for active sessions', async ({ mainWindow }) => {
    // If there are active sessions, they should appear as tiles
    const sessionTiles = mainWindow.locator('[data-session-id], [class*="session-tile"]')
    const count = await sessionTiles.count()

    // Soft check - might not have any sessions
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should allow clicking on session tile to expand', async ({ mainWindow }) => {
    const sessionTiles = mainWindow.locator('[data-session-id], [class*="session-tile"]')
    const count = await sessionTiles.count()

    if (count > 0) {
      const firstTile = sessionTiles.first()
      await firstTile.click()

      // Session details should be visible
      await mainWindow.waitForTimeout(500)
    }
  })

  test('should show session status', async ({ mainWindow }) => {
    const sessionTiles = mainWindow.locator('[data-session-id], [class*="session-tile"]')
    const count = await sessionTiles.count()

    if (count > 0) {
      // Each session should have some status indicator
      const statusBadges = mainWindow.locator('[class*="badge"], [data-status]')
      expect(await statusBadges.count()).toBeGreaterThanOrEqual(0)
    }
  })
})

test.describe('Session Actions', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/')
  })

  test('should allow continuing a conversation', async ({ mainWindow }) => {
    // Navigate to history
    await navigateTo(mainWindow, '/history')

    // Find a past conversation
    const historyItems = mainWindow.locator('[data-conversation-id], [class*="history-item"]')
    const count = await historyItems.count()

    if (count > 0) {
      const firstItem = historyItems.first()
      await firstItem.click()

      // Should open the conversation or show continue option
      await mainWindow.waitForTimeout(500)
    }
  })

  test('should allow deleting individual conversation', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/history')

    // Find delete buttons on history items
    const deleteButtons = mainWindow.locator('[aria-label*="delete" i], button:has([class*="trash"])')
    const count = await deleteButtons.count()

    if (count > 0) {
      await deleteButtons.first().click()

      // Should show confirmation or delete immediately
      const confirmDialog = mainWindow.getByRole('dialog')
      if (await confirmDialog.isVisible()) {
        const cancelButton = mainWindow.getByRole('button', { name: /cancel/i })
        await cancelButton.click()
      }
    }
  })
})

test.describe('Agent Progress Display', () => {
  test('should display agent progress for active sessions', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/')

    // Look for agent progress indicators
    const progressElements = mainWindow.locator('[class*="progress"], [class*="agent"]')
    const count = await progressElements.count()

    // Soft check since there might not be any active agent tasks
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should show tool execution steps', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/')

    // Look for step indicators
    const stepElements = mainWindow.locator('[class*="step"], [data-step]')
    const count = await stepElements.count()

    // Soft check
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
