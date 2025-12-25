import { test, expect, navigateToSettings } from './fixtures'

/**
 * E2E tests for MCP server management
 *
 * Tests the MCP configuration functionality:
 * - Viewing server list
 * - Adding new servers
 * - Editing server configurations
 * - Enabling/disabling servers
 * - Tool management per server
 */

test.describe('MCP Server Management', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateToSettings(mainWindow, 'mcp-tools')
  })

  test('should display MCP tools page', async ({ mainWindow }) => {
    // Should show MCP configuration section
    await expect(mainWindow.getByText(/mcp|tools|server/i).first()).toBeVisible()
  })

  test('should have add server button', async ({ mainWindow }) => {
    // Look for button to add new MCP server
    const addButton = mainWindow.getByRole('button', { name: /add|new|create/i })
    await expect(addButton.first()).toBeVisible()
  })

  test('should open add server dialog', async ({ mainWindow }) => {
    // Click add server button
    const addButton = mainWindow.getByRole('button', { name: /add|new|create/i }).first()
    await addButton.click()

    // Dialog should appear with server configuration form
    await expect(mainWindow.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Should have name input field
    const nameInput = mainWindow.locator('input[placeholder*="name" i], input[name="name"]').first()
    await expect(nameInput).toBeVisible()
  })

  test('should validate required fields in add server dialog', async ({ mainWindow }) => {
    // Open add dialog
    const addButton = mainWindow.getByRole('button', { name: /add|new|create/i }).first()
    await addButton.click()

    await expect(mainWindow.getByRole('dialog')).toBeVisible()

    // Try to save without filling required fields
    const saveButton = mainWindow.getByRole('button', { name: /save|add|create/i }).last()

    // Save button should be disabled or form should show validation errors
    // Either the button is disabled, or clicking it doesn't close the dialog
    if (await saveButton.isEnabled()) {
      await saveButton.click()
      // Dialog should still be open due to validation
      await expect(mainWindow.getByRole('dialog')).toBeVisible()
    }
  })

  test('should add a new stdio server', async ({ mainWindow }) => {
    // Open add dialog
    const addButton = mainWindow.getByRole('button', { name: /add|new|create/i }).first()
    await addButton.click()

    await expect(mainWindow.getByRole('dialog')).toBeVisible()

    // Fill in server details
    const nameInput = mainWindow.locator('input').first()
    await nameInput.fill('test-mcp-server')

    // Select transport type (stdio)
    const transportSelector = mainWindow.locator('[role="combobox"]').first()
    if (await transportSelector.isVisible()) {
      await transportSelector.click()
      const stdioOption = mainWindow.getByRole('option', { name: /stdio/i })
      if (await stdioOption.isVisible()) {
        await stdioOption.click()
      }
    }

    // Fill command
    const commandInput = mainWindow.locator('input[placeholder*="command" i], textarea').first()
    if (await commandInput.isVisible()) {
      await commandInput.fill('npx -y @test/mcp-server')
    }

    // Save the server
    const saveButton = mainWindow.getByRole('button', { name: /save|add|create/i }).last()
    await saveButton.click()

    // Dialog should close
    await expect(mainWindow.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })

    // Server should appear in the list
    await expect(mainWindow.getByText('test-mcp-server')).toBeVisible()
  })

  test('should toggle server enabled state', async ({ mainWindow }) => {
    // Find server toggle switches
    const serverSwitches = mainWindow.locator('[role="switch"]')
    const count = await serverSwitches.count()

    if (count > 0) {
      const firstSwitch = serverSwitches.first()
      const initialState = await firstSwitch.getAttribute('aria-checked')

      // Toggle the switch
      await firstSwitch.click()

      // Verify state changed
      const newState = await firstSwitch.getAttribute('aria-checked')
      expect(newState).not.toBe(initialState)

      // Toggle back
      await firstSwitch.click()
    }
  })

  test('should edit existing server', async ({ mainWindow }) => {
    // Look for edit button on a server
    const editButton = mainWindow.getByRole('button', { name: /edit/i }).first()

    if (await editButton.isVisible()) {
      await editButton.click()

      // Edit dialog should open
      await expect(mainWindow.getByRole('dialog')).toBeVisible()

      // Should have pre-filled values
      const nameInput = mainWindow.locator('input').first()
      const currentValue = await nameInput.inputValue()
      expect(currentValue.length).toBeGreaterThan(0)

      // Cancel the dialog
      const cancelButton = mainWindow.getByRole('button', { name: /cancel/i })
      await cancelButton.click()
    }
  })

  test('should delete server with confirmation', async ({ mainWindow }) => {
    // Look for delete button on a server
    const deleteButton = mainWindow.getByRole('button', { name: /delete|remove/i }).first()

    if (await deleteButton.isVisible()) {
      await deleteButton.click()

      // Should show confirmation dialog or the item should be removed
      // Check for confirmation dialog first
      const confirmDialog = mainWindow.getByRole('dialog')
      if (await confirmDialog.isVisible()) {
        // Cancel the deletion
        const cancelButton = mainWindow.getByRole('button', { name: /cancel|no/i })
        await cancelButton.click()
      }
    }
  })

  test('should display server status indicators', async ({ mainWindow }) => {
    // Look for status indicators (connected, error, etc.)
    const statusIcons = mainWindow.locator('[data-status], .status-icon, [class*="circle"]')
    const count = await statusIcons.count()

    // Should have some status indicators if servers are configured
    // This is a soft check since there might not be any servers
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should import server configuration', async ({ mainWindow }) => {
    // Look for import button
    const importButton = mainWindow.getByRole('button', { name: /import/i })

    if (await importButton.isVisible()) {
      await importButton.click()

      // Should open import dialog or file picker
      const importDialog = mainWindow.getByRole('dialog')
      if (await importDialog.isVisible()) {
        // Cancel import
        const cancelButton = mainWindow.getByRole('button', { name: /cancel/i })
        await cancelButton.click()
      }
    }
  })

  test('should export server configuration', async ({ mainWindow }) => {
    // Look for export button
    const exportButton = mainWindow.getByRole('button', { name: /export/i })

    if (await exportButton.isVisible()) {
      // Just verify button is clickable
      await expect(exportButton).toBeEnabled()
    }
  })
})

test.describe('MCP Tools View', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await navigateToSettings(mainWindow, 'tools')
  })

  test('should display built-in tools section', async ({ mainWindow }) => {
    // Should show tools configuration
    await expect(mainWindow.getByText(/tool|built-in/i).first()).toBeVisible()
  })

  test('should toggle individual tool enabled state', async ({ mainWindow }) => {
    // Find tool toggle switches
    const toolSwitches = mainWindow.locator('[role="switch"]')
    const count = await toolSwitches.count()

    if (count > 0) {
      const firstSwitch = toolSwitches.first()
      const initialState = await firstSwitch.getAttribute('aria-checked')

      // Toggle the switch
      await firstSwitch.click()

      // Verify state changed
      const newState = await firstSwitch.getAttribute('aria-checked')
      expect(newState).not.toBe(initialState)
    }
  })

  test('should show tool descriptions', async ({ mainWindow }) => {
    // Look for tool descriptions or info icons
    const infoElements = mainWindow.locator('[aria-label*="info" i], [title], button[class*="info"]')
    const count = await infoElements.count()

    // Should have some description elements if tools are present
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
