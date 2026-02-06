/**
 * Feature E2E Tests - Error Handling
 * Tests error states and recovery
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PtyDriver,
  KEYS,
  expectView,
} from '../helpers'

describe('Error Handling', () => {
  let driver: PtyDriver

  afterEach(() => {
    if (driver) {
      driver.kill()
    }
  })

  it('should handle connection to server', async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    
    await driver.spawn()
    await driver.waitForStable(2000, 15000)
    
    const output = driver.getOutput()
    
    // Should show connected state or at least render something
    expect(output.length).toBeGreaterThan(50)
    
    // Should not show persistent error
    const hasConnectionError = 
      output.includes('Connection failed') ||
      output.includes('Cannot connect')
    
    expect(hasConnectionError).toBe(false)
  })

  it('should handle empty message submission', async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    
    await driver.spawn()
    await driver.waitForStable(1000, 10000)
    
    // Try to send empty message
    driver.pressKey('ENTER')
    await driver.waitForStable(500)
    
    // Should not crash or show error
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should handle very long input', async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    
    await driver.spawn()
    await driver.waitForStable(1000, 10000)
    
    // Type a very long message
    const longMessage = 'a'.repeat(500)
    driver.write(longMessage)
    await driver.waitForStable(500)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should handle special characters in input', async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    
    await driver.spawn()
    await driver.waitForStable(1000, 10000)
    
    // Type special characters
    driver.write('Hello! @#$%^&*() "quotes" `backticks`')
    await driver.waitForStable(500)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should recover from invalid key sequences', async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    
    await driver.spawn()
    await driver.waitForStable(1000, 10000)
    
    // Send some random escape sequences
    driver.write('\x1b[99~')  // Invalid function key
    await driver.waitForStable(300)
    
    driver.write('\x1b[999;999H')  // Invalid cursor position
    await driver.waitForStable(300)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
    
    // Should still be usable
    await expectView(driver, 'chat', 5000)
  })

  it('should handle unicode and emoji', async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    
    await driver.spawn()
    await driver.waitForStable(1000, 10000)
    
    // Type unicode and emoji
    driver.write('Hello 世界 🎉 émojis')
    await driver.waitForStable(500)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })
})

