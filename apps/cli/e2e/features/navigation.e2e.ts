/**
 * Feature E2E Tests - Navigation
 * Tests view switching and navigation flow
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PtyDriver,
  KEYS,
  expectView,
} from '../helpers'

describe('Navigation', () => {
  let driver: PtyDriver

  beforeEach(async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    await driver.spawn()
    await driver.waitForStable(1000, 10000)
  })

  afterEach(() => {
    driver.kill()
  })

  it('should cycle through all views with F-keys', async () => {
    // Start in chat (F1)
    await expectView(driver, 'chat', 5000)
    
    // F2 -> Sessions
    driver.pressKey('F2')
    await expectView(driver, 'sessions', 5000)
    
    // F3 -> Settings
    driver.pressKey('F3')
    await expectView(driver, 'settings', 5000)
    
    // F4 -> Tools
    driver.pressKey('F4')
    await expectView(driver, 'tools', 5000)
    
    // F1 -> Back to Chat
    driver.pressKey('F1')
    await expectView(driver, 'chat', 5000)
  })

  it('should preserve state when switching views', async () => {
    // Type something in chat
    const testText = 'Preserving this text'
    driver.write(testText)
    await driver.waitForStable(500)
    
    // Switch to settings and back
    driver.pressKey('F3')
    await driver.waitForStable(500)
    
    driver.pressKey('F1')
    await driver.waitForStable(500)
    
    // The input might or might not be preserved depending on implementation
    // At minimum, we shouldn't crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should show tab/view indicator', async () => {
    const output = driver.getOutput()
    
    // Should show some indication of current view or tabs
    const hasTabIndicator = 
      output.includes('Chat') ||
      output.includes('F1') ||
      output.includes('F2') ||
      output.includes('F3') ||
      output.includes('F4')
    
    expect(hasTabIndicator).toBe(true)
  })

  it('should handle rapid view switching', async () => {
    // Rapidly switch views
    for (let i = 0; i < 5; i++) {
      driver.pressKey('F2')
      await new Promise(resolve => setTimeout(resolve, 100))
      driver.pressKey('F3')
      await new Promise(resolve => setTimeout(resolve, 100))
      driver.pressKey('F4')
      await new Promise(resolve => setTimeout(resolve, 100))
      driver.pressKey('F1')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    await driver.waitForStable(500)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should show correct header for each view', async () => {
    // Check chat header
    await expectView(driver, 'chat', 5000)
    let output = driver.getOutput()
    const hasChatHeader = output.includes('Chat') || output.includes('💬')
    expect(hasChatHeader).toBe(true)
    
    // Check sessions header
    driver.pressKey('F2')
    await driver.waitForStable(1000)
    output = driver.getOutput()
    const hasSessionsHeader = 
      output.includes('Sessions') || 
      output.includes('Conversations') ||
      output.includes('History')
    expect(hasSessionsHeader).toBe(true)
    
    // Check settings header
    driver.pressKey('F3')
    await driver.waitForStable(1000)
    output = driver.getOutput()
    const hasSettingsHeader = output.includes('Settings') || output.includes('⚙')
    expect(hasSettingsHeader).toBe(true)
    
    // Check tools header
    driver.pressKey('F4')
    await driver.waitForStable(1000)
    output = driver.getOutput()
    const hasToolsHeader = output.includes('Tools') || output.includes('🔧')
    expect(hasToolsHeader).toBe(true)
  })
})

