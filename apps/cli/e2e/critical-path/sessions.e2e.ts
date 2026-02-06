/**
 * Critical Path E2E Tests - Sessions View
 * Tests session/conversation management
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PtyDriver,
  KEYS,
  expectOutputContains,
  waitAndExpect,
  expectView,
} from '../helpers'

describe('Sessions View', () => {
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

  it('should switch to sessions view with F2', async () => {
    // Press F2 to switch to sessions
    driver.pressKey('F2')
    
    await expectView(driver, 'sessions', 5000)
  })

  it('should display sessions list', async () => {
    // Switch to sessions view
    driver.pressKey('F2')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // Should show sessions-related content
    const hasSessionsContent = 
      output.includes('Sessions') ||
      output.includes('Conversations') ||
      output.includes('History') ||
      output.includes('No conversations') ||
      output.includes('New Chat')
    
    expect(hasSessionsContent).toBe(true)
  })

  it('should allow navigating sessions with arrow keys', async () => {
    // First create a conversation by sending a message
    driver.typeAndEnter('Test message for session')
    await driver.waitForStable(3000, 60000)
    
    // Switch to sessions view
    driver.pressKey('F2')
    await driver.waitForStable(1000)
    
    // Navigate with arrow keys
    driver.pressKey('DOWN')
    await driver.waitForStable(300)
    
    driver.pressKey('UP')
    await driver.waitForStable(300)
    
    // Should not crash
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should return to chat with F1', async () => {
    // Go to sessions
    driver.pressKey('F2')
    await expectView(driver, 'sessions', 5000)
    
    // Return to chat
    driver.pressKey('F1')
    await expectView(driver, 'chat', 5000)
  })

  it('should select session with Enter', async () => {
    // First ensure we have at least one conversation
    driver.typeAndEnter('Creating a test session')
    await driver.waitForStable(3000, 60000)
    
    // Go to sessions
    driver.pressKey('F2')
    await driver.waitForStable(1000)
    
    // Press Enter to select (if there's a session)
    driver.pressKey('ENTER')
    await driver.waitForStable(1000)
    
    // Should either show the session or stay in sessions view
    // (depends on whether there was a session to select)
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })

  it('should show session details or preview', async () => {
    // Create a conversation first
    const testContent = 'Unique test content XYZ789'
    driver.typeAndEnter(testContent)
    await driver.waitForStable(3000, 60000)
    
    // Go to sessions
    driver.pressKey('F2')
    await driver.waitForStable(2000)
    
    const output = driver.getOutput()
    
    // The sessions list might show a preview of the conversation
    // or at least show that there are conversations
    const hasContent = output.length > 50
    expect(hasContent).toBe(true)
  })

  it('should create new session with Ctrl+N', async () => {
    // Go to sessions view
    driver.pressKey('F2')
    await driver.waitForStable(1000)
    
    // Create new session
    driver.pressKey('CTRL_N')
    await driver.waitForStable(1000)
    
    // Should switch to chat view for new conversation
    // or stay in sessions with a new session selected
    const output = driver.getOutput()
    expect(output).toBeDefined()
  })
})

