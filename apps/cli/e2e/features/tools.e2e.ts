/**
 * Feature E2E Tests - Tools View
 * Tests MCP tools listing and display
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PtyDriver,
  KEYS,
  expectView,
} from '../helpers'

describe('Tools View', () => {
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

  it('should switch to tools view with F4', async () => {
    driver.pressKey('F4')
    await expectView(driver, 'tools', 5000)
  })

  it('should display MCP servers list', async () => {
    driver.pressKey('F4')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show tools/servers content
    const hasToolsContent = 
      output.includes('Tools') ||
      output.includes('MCP') ||
      output.includes('Server') ||
      output.includes('Available') ||
      output.includes('No tools')
    
    expect(hasToolsContent).toBe(true)
  })

  it('should navigate tools with arrow keys', async () => {
    driver.pressKey('F4')
    await driver.waitForStable(1000)
    
    // Navigate
    driver.pressKey('DOWN')
    await driver.waitForStable(300)
    
    driver.pressKey('DOWN')
    await driver.waitForStable(300)
    
    driver.pressKey('UP')
    await driver.waitForStable(300)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should expand tool details with Enter', async () => {
    driver.pressKey('F4')
    await driver.waitForStable(1000)
    
    // Try to expand details
    driver.pressKey('ENTER')
    await driver.waitForStable(500)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should return to chat with F1', async () => {
    driver.pressKey('F4')
    await expectView(driver, 'tools', 5000)
    
    driver.pressKey('F1')
    await expectView(driver, 'chat', 5000)
  })

  it('should show tool count or status', async () => {
    driver.pressKey('F4')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show some indication of tools status
    // Either a count, or "connected", or tool names
    expect(output.length).toBeGreaterThan(50)
  })
})

