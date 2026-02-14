import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  estimateTokensFromMessages,
  getMaxContextTokens,
  getProviderAndModel,
} from './context-budget'

// Setup configStore mock
const mockGet = vi.fn()
vi.mock('./config', () => ({
  configStore: {
    get: mockGet,
  },
}))

describe('estimateTokensFromMessages', () => {
  it('should estimate tokens based on character count', () => {
    const messages = [
      { role: 'user', content: 'Hello world' }, // 11 chars
      { role: 'assistant', content: 'Hi there' }, // 8 chars
    ]
    const tokens = estimateTokensFromMessages(messages)
    expect(tokens).toBe(Math.ceil((11 + 8) / 4))
  })

  it('should handle empty messages', () => {
    const tokens = estimateTokensFromMessages([])
    expect(tokens).toBe(0)
  })

  it('should handle messages with empty content', () => {
    const messages = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'test' },
    ]
    const tokens = estimateTokensFromMessages(messages)
    expect(tokens).toBe(Math.ceil(4 / 4))
  })

  it('should handle null/undefined content gracefully', () => {
    const messages = [
      { role: 'user', content: null as unknown as string },
      { role: 'assistant', content: undefined as unknown as string },
    ]
    const tokens = estimateTokensFromMessages(messages)
    expect(tokens).toBe(0)
  })

  it('should handle very long content', () => {
    const longContent = 'a'.repeat(10000)
    const messages = [{ role: 'user', content: longContent }]
    const tokens = estimateTokensFromMessages(messages)
    expect(tokens).toBe(Math.ceil(10000 / 4))
  })
})

describe('getProviderAndModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({})
  })

  it('should return defaults when no config', () => {
    const result = getProviderAndModel()
    expect(result.providerId).toBe('openai')
    expect(result.model).toBe('gpt-4o-mini')
  })

  it('should fall back to default provider when not specified', () => {
    mockGet.mockReturnValue({})
    const result = getProviderAndModel()
    expect(result.providerId).toBe('openai')
  })
})

describe('getMaxContextTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({})
  })

  it('should use model registry for known GPT models', async () => {
    const tokens = await getMaxContextTokens('openai', 'gpt-4')
    expect(tokens).toBe(128_000)
  })

  it('should use model registry for Claude models', async () => {
    const tokens = await getMaxContextTokens('anthropic', 'claude-3.5-sonnet')
    expect(tokens).toBe(200_000)
  })

  it('should use model registry for Gemini models', async () => {
    const tokens = await getMaxContextTokens('gemini', 'gemini-1.5-flash')
    expect(tokens).toBe(1_000_000)
  })

  it('should return fallback for unknown models', async () => {
    const tokens = await getMaxContextTokens('unknown', 'unknown-model')
    expect(tokens).toBe(64_000) // Generic fallback
  })

  it('should handle o-series reasoning models', async () => {
    const tokens = await getMaxContextTokens('openai', 'o1')
    expect(tokens).toBe(200_000)
  })

  it('should handle Groq provider fallback', async () => {
    const tokens = await getMaxContextTokens('groq', 'unknown-70b-model')
    expect(tokens).toBe(32_768) // Groq 70b fallback
  })
})
