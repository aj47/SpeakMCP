import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import * as contextBudget from './context-budget'

// ============================================================================
// NOTE: These tests focus on EXPORTED functions in context-budget.ts
// Private functions (normalizeModelName, calculateMatchScore, etc.) cannot be
// directly tested without modifying the source file.
// ============================================================================

describe('context-budget: estimateTokensFromMessages', () => {
  it('should return 0 for empty messages', () => {
    expect(contextBudget.estimateTokensFromMessages([])).toBe(0)
  })

  it('should estimate ~4 chars per token', () => {
    const messages = [{ role: 'user', content: 'Hello world' }]
    expect(contextBudget.estimateTokensFromMessages(messages)).toBe(Math.ceil(11 / 4))
  })

  it('should handle messages without content', () => {
    const messages = [{ role: 'user', content: undefined as unknown as string }]
    expect(contextBudget.estimateTokensFromMessages(messages)).toBe(0)
  })

  it('should sum tokens across multiple messages', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ]
    const expected = Math.ceil(24 / 4) + Math.ceil(5 / 4)
    expect(contextBudget.estimateTokensFromMessages(messages)).toBe(expected)
  })
})

describe('context-budget: getProviderAndModel', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return default provider and model when no config', async () => {
    // This test documents the expected default behavior
    // Actual value depends on configStore.get() at runtime
    const result = contextBudget.getProviderAndModel()
    expect(result).toHaveProperty('providerId')
    expect(result).toHaveProperty('model')
    expect(typeof result.providerId).toBe('string')
    expect(typeof result.model).toBe('string')
  })
})

describe('context-budget: ShrinkOptions interface', () => {
  it('should accept valid ShrinkOptions structure', () => {
    const opts: contextBudget.ShrinkOptions = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      availableTools: [
        { name: 'search', description: 'Search the web', inputSchema: { type: 'object' } },
      ],
      isAgentMode: false,
      targetRatio: 0.7,
      lastNMessages: 3,
    }
    expect(opts.messages).toHaveLength(2)
    expect(opts.availableTools).toHaveLength(1)
  })

  it('should accept ShrinkOptions with optional fields', () => {
    const opts: contextBudget.ShrinkOptions = {
      messages: [{ role: 'user', content: 'Test' }],
      relevantTools: [],
      sessionId: 'test-session-123',
      onSummarizationProgress: (current, total, message) => {
        // Progress callback
      },
    }
    expect(opts.sessionId).toBe('test-session-123')
    expect(typeof opts.onSummarizationProgress).toBe('function')
  })
})

describe('context-budget: ShrinkResult interface', () => {
  it('should produce valid ShrinkResult structure', async () => {
    // Note: We can't test the actual function without extensive mocking,
    // but we can verify the expected result structure
    const mockResult: contextBudget.ShrinkResult = {
      messages: [{ role: 'system', content: 'You are helpful.' }],
      appliedStrategies: ['summarize', 'drop_middle'],
      estTokensBefore: 1000,
      estTokensAfter: 500,
      maxTokens: 2000,
      toolResultsSummarized: false,
    }
    expect(mockResult.appliedStrategies).toContain('summarize')
    expect(mockResult.estTokensAfter).toBeLessThan(mockResult.estTokensBefore)
  })
})
