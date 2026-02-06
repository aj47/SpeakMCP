/**
 * Critical Path E2E Tests - Settings View
 * Tests settings display and modification
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PtyDriver,
  KEYS,
  expectOutputContains,
  waitAndExpect,
  expectView,
} from '../helpers'

describe('Settings View', () => {
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

  it('should switch to settings view with F3', async () => {
    driver.pressKey('F3')
    await expectView(driver, 'settings', 5000)
  })

  it('should display LLM provider setting', async () => {
    driver.pressKey('F3')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show provider configuration
    const hasProvider = 
      output.includes('Provider') ||
      output.includes('provider') ||
      output.includes('LLM') ||
      output.includes('OpenAI') ||
      output.includes('Groq') ||
      output.includes('Gemini') ||
      output.includes('OpenRouter')
    
    expect(hasProvider).toBe(true)
  })

  it('should display model setting', async () => {
    driver.pressKey('F3')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show model configuration
    const hasModel = 
      output.includes('Model') ||
      output.includes('model') ||
      output.includes('gpt') ||
      output.includes('llama') ||
      output.includes('gemini') ||
      output.includes('claude')
    
    expect(hasModel).toBe(true)
  })

  it('should display max iterations setting', async () => {
    driver.pressKey('F3')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show max iterations
    const hasMaxIter = 
      output.includes('Max') ||
      output.includes('Iterations') ||
      output.includes('iterations') ||
      output.includes('limit')
    
    expect(hasMaxIter).toBe(true)
  })

  it('should show MCP servers section', async () => {
    driver.pressKey('F3')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show MCP servers
    const hasMcp = 
      output.includes('MCP') ||
      output.includes('Server') ||
      output.includes('Tool') ||
      output.includes('server')
    
    expect(hasMcp).toBe(true)
  })

  it('should navigate settings with arrow keys', async () => {
    driver.pressKey('F3')
    await driver.waitForStable(1000)
    
    // Navigate down
    driver.pressKey('DOWN')
    await driver.waitForStable(300)
    
    driver.pressKey('DOWN')
    await driver.waitForStable(300)
    
    // Navigate up
    driver.pressKey('UP')
    await driver.waitForStable(300)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should return to chat with F1', async () => {
    // Go to settings
    driver.pressKey('F3')
    await expectView(driver, 'settings', 5000)
    
    // Return to chat
    driver.pressKey('F1')
    await expectView(driver, 'chat', 5000)
  })

  it('should allow editing settings with Enter', async () => {
    driver.pressKey('F3')
    await driver.waitForStable(1000)
    
    // Press Enter to edit current setting
    driver.pressKey('ENTER')
    await driver.waitForStable(500)
    
    // Press Escape to cancel
    driver.pressKey('ESCAPE')
    await driver.waitForStable(500)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })
})

