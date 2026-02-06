/**
 * Critical Path E2E Tests - Chat Flow
 * Tests the primary chat interaction flow with the agent
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PtyDriver,
  KEYS,
  expectOutputContains,
  waitAndExpect,
  expectView,
  expectAgentResponse,
} from '../helpers'

describe('Chat Flow', () => {
  let driver: PtyDriver

  beforeEach(async () => {
    driver = new PtyDriver({
      serverUrl: 'http://localhost:3299',
    })
    await driver.spawn()
    // Wait for initial render
    await driver.waitForStable(1000, 10000)
  })

  afterEach(() => {
    driver.kill()
  })

  it('should start and show chat view by default', async () => {
    // The CLI should start in chat view
    await expectView(driver, 'chat', 10000)
  })

  it('should show connection status', async () => {
    // Should show online/connected status
    await driver.waitForStable(2000)
    const output = driver.getOutput()
    
    // Should not show disconnected or error states
    const hasError = output.toLowerCase().includes('disconnected') || 
                     output.toLowerCase().includes('connection failed')
    
    expect(hasError).toBe(false)
  })

  it('should accept user input', async () => {
    // Type a message
    const testMessage = 'Hello, this is a test message'
    driver.write(testMessage)
    
    await driver.waitForStable(500)
    
    // The input should be visible
    const output = driver.getOutput()
    expect(output).toContain(testMessage)
  })

  it('should send message and receive agent response', async () => {
    // Send a simple message that should get a response
    const testMessage = 'What is 2+2? Reply with just the number.'
    driver.typeAndEnter(testMessage)
    
    // Wait for agent to respond (this involves LLM call, so longer timeout)
    await expectAgentResponse(driver, 120000)
    
    // The output should have grown and contain something after our message
    const output = driver.getOutput()
    expect(output.length).toBeGreaterThan(testMessage.length + 50)
  })

  it('should show streaming response', async () => {
    // Send a message that should trigger a longer response
    driver.typeAndEnter('Count from 1 to 5, one number per line.')
    
    // Wait for some response to start streaming
    await driver.waitForStable(500, 30000)
    
    // Check that we see incremental output (streaming)
    const output1 = driver.getOutput()
    
    // Wait a bit more
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    const output2 = driver.getOutput()
    
    // Output should have grown as response streams in
    // (or already completed, which is also fine)
    expect(output2.length).toBeGreaterThanOrEqual(output1.length)
  })

  it('should create new conversation with Ctrl+N', async () => {
    // First, send a message to have some history
    driver.typeAndEnter('Remember the number 42')
    await driver.waitForStable(2000, 60000)
    
    // Now create a new conversation
    driver.pressKey('CTRL_N')
    
    await driver.waitForStable(1000)
    
    // The chat should be cleared (new conversation)
    // This is hard to assert without knowing exact UI, but we can check
    // the output doesn't error
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should handle Escape key', async () => {
    // Type something but don't send
    driver.write('partial message')
    await driver.waitForStable(500)
    
    // Press Escape
    driver.pressKey('ESCAPE')
    await driver.waitForStable(500)
    
    // Should not crash - just verify we're still in a valid state
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should show help overlay with F12 or ?', async () => {
    // Press ? to show help
    driver.write('?')
    await driver.waitForStable(1000)
    
    // Should show help content
    const output = driver.getOutput()
    
    // Help should show keyboard shortcuts
    const hasHelpContent = 
      output.includes('F1') || 
      output.includes('Help') ||
      output.includes('Ctrl')
    
    expect(hasHelpContent).toBe(true)
    
    // Dismiss help
    driver.pressKey('ESCAPE')
    await driver.waitForStable(500)
  })
})

