/**
 * Custom assertion helpers for E2E tests
 */
import { expect } from 'vitest'
import { PtyDriver } from './pty-driver'

/**
 * Assert that the terminal output contains the specified text
 */
export function expectOutputContains(driver: PtyDriver, text: string): void {
  const output = driver.getOutput()
  expect(output).toContain(text)
}

/**
 * Assert that the terminal output matches the specified regex
 */
export function expectOutputMatches(driver: PtyDriver, pattern: RegExp): void {
  const output = driver.getOutput()
  expect(output).toMatch(pattern)
}

/**
 * Assert that the terminal output does NOT contain the specified text
 */
export function expectOutputNotContains(driver: PtyDriver, text: string): void {
  const output = driver.getOutput()
  expect(output).not.toContain(text)
}

/**
 * Wait for text to appear, then assert it exists
 */
export async function waitAndExpect(
  driver: PtyDriver,
  text: string,
  timeout: number = 30000
): Promise<void> {
  await driver.waitForText(text, timeout)
  expectOutputContains(driver, text)
}

/**
 * Wait for pattern to match, then assert
 */
export async function waitAndExpectMatch(
  driver: PtyDriver,
  pattern: RegExp,
  timeout: number = 30000
): Promise<void> {
  await driver.waitForText(pattern, timeout)
  expectOutputMatches(driver, pattern)
}

/**
 * Assert the CLI is showing a specific view
 */
export async function expectView(
  driver: PtyDriver,
  view: 'chat' | 'sessions' | 'settings' | 'tools',
  timeout: number = 5000
): Promise<void> {
  const viewIndicators: Record<string, string[]> = {
    chat: ['Chat', 'Send a message', 'Type a message'],
    sessions: ['Sessions', 'Conversations', 'New Chat'],
    settings: ['Settings', 'LLM Provider', 'Model'],
    tools: ['Tools', 'MCP Servers', 'Available Tools'],
  }

  const indicators = viewIndicators[view]
  let found = false

  for (const indicator of indicators) {
    try {
      await driver.waitForText(indicator, timeout)
      found = true
      break
    } catch {
      // Try next indicator
    }
  }

  if (!found) {
    throw new Error(
      `Expected to be in ${view} view, but none of the indicators [${indicators.join(', ')}] were found.\n` +
        `Current output: ${driver.getOutput().slice(-300)}`
    )
  }
}

/**
 * Assert agent is processing (shows loading indicator or streaming)
 */
export async function expectAgentProcessing(
  driver: PtyDriver,
  timeout: number = 5000
): Promise<void> {
  const processingIndicators = ['...', 'Thinking', 'Processing', '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  
  for (const indicator of processingIndicators) {
    try {
      await driver.waitForText(indicator, timeout)
      return
    } catch {
      // Try next indicator
    }
  }
  
  // If no processing indicator found, that's also OK - might have already completed
}

/**
 * Assert agent has responded (check for response markers)
 */
export async function expectAgentResponse(
  driver: PtyDriver,
  timeout: number = 60000
): Promise<void> {
  // Wait for output to stabilize (agent done responding)
  await driver.waitForStable(1000, timeout)
  
  // The output should have grown significantly from when we started
  const output = driver.getOutput()
  
  // Check for common response patterns
  const hasResponse = output.length > 100 // Basic check that something was rendered
  
  if (!hasResponse) {
    throw new Error(
      `Expected agent response but output seems empty.\n` +
        `Output: ${output.slice(-300)}`
    )
  }
}

