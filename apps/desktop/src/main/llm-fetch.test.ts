import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('./config', () => ({
  configStore: {
    get: () => ({
      apiRetryCount: 3,
      apiRetryBaseDelay: 100,
      apiRetryMaxDelay: 1000,
      openaiApiKey: 'test-key',
      openaiBaseUrl: 'https://api.openai.com/v1',
      mcpToolsOpenaiModel: 'gpt-4o-mini',
      mcpToolsProviderId: 'openai',
    }),
  },
}))

vi.mock('./diagnostics', () => ({
  diagnosticsService: {
    logError: vi.fn(),
    logWarning: vi.fn(),
    logInfo: vi.fn(),
  },
}))

vi.mock('./debug', () => ({
  isDebugLLM: () => false,
  logLLM: vi.fn(),
}))

vi.mock('./state', () => ({
  state: {
    shouldStopAgent: false,
    isAgentModeActive: false,
    agentIterationCount: 0,
  },
  agentSessionStateManager: {
    shouldStopSession: () => false,
  },
  llmRequestAbortManager: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}))

// Mock the AI SDK functions
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  // Mock the tool helper - returns a simple object representing the tool
  tool: vi.fn((config: any) => ({ ...config, _type: 'tool' })),
  // Mock jsonSchema helper - returns the schema wrapped
  jsonSchema: vi.fn((schema: any) => ({ _type: 'jsonSchema', schema })),
}))

// Mock the ai-sdk-provider module
vi.mock('./ai-sdk-provider', () => ({
  createLanguageModel: vi.fn(() => ({})),
  getCurrentProviderId: vi.fn(() => 'openai'),
  getTranscriptProviderId: vi.fn(() => 'openai'),
}))

describe('LLM Fetch with AI SDK', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should return parsed JSON content from LLM response', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    generateTextMock.mockResolvedValue({
      text: '{"content": "Hello, world!", "needsMoreWork": false}',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toBe('Hello, world!')
    expect(result.needsMoreWork).toBe(false)
  })

  it('should return plain text when JSON parsing fails', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    generateTextMock.mockResolvedValue({
      text: 'This is a plain text response without JSON',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toBe('This is a plain text response without JSON')
    // When there are no tool calls and no JSON, the task is considered complete
    expect(result.needsMoreWork).toBe(false)
  })

  it('should extract toolCalls from JSON response', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        toolCalls: [
          { name: 'search', arguments: { query: 'test' } }
        ],
        content: 'Searching...',
        needsMoreWork: true
      }),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0].name).toBe('search')
    expect(result.content).toBe('Searching...')
    expect(result.needsMoreWork).toBe(true)
  })

  it('should throw on empty response', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    generateTextMock.mockResolvedValue({
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 0 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    await expect(
      makeLLMCallWithFetch([{ role: 'user', content: 'test' }], 'openai')
    ).rejects.toThrow('LLM returned empty response')
  })

  it('should retry on retryable errors', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    let callCount = 0
    generateTextMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        throw new Error('503 Service Unavailable')
      }
      return Promise.resolve({
        text: '{"content": "Success after retry"}',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
      } as any)
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(callCount).toBe(2)
    expect(result.content).toBe('Success after retry')
  })

  it('should not retry on abort errors', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    generateTextMock.mockRejectedValue(abortError)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    await expect(
      makeLLMCallWithFetch([{ role: 'user', content: 'test' }], 'openai')
    ).rejects.toThrow('Aborted')

    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })

  it('should handle native AI SDK tool calls when tools are provided', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    // Mock a response with native tool calls
    generateTextMock.mockResolvedValue({
      text: 'I will help you play wordle.',
      finishReason: 'tool-calls',
      usage: { promptTokens: 10, completionTokens: 20 },
      toolCalls: [
        {
          toolName: 'play_wordle',
          args: { word: 'hello' },
          toolCallId: 'call_123',
        },
      ],
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const mockTools = [
      {
        name: 'play_wordle',
        description: 'Play a game of wordle',
        inputSchema: {
          type: 'object',
          properties: {
            word: { type: 'string' },
          },
        },
      },
    ]

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'play wordle' }],
      'openai',
      undefined,
      undefined,
      mockTools
    )

    expect(result.toolCalls).toBeDefined()
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].name).toBe('play_wordle')
    expect(result.toolCalls![0].arguments).toEqual({ word: 'hello' })
    expect(result.needsMoreWork).toBe(true)
  })

  it('should pass tools to generateText when provided', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    generateTextMock.mockResolvedValue({
      text: 'No tools needed for this response.',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const mockTools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ]

    await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai',
      undefined,
      undefined,
      mockTools
    )

    // Verify generateText was called with tools
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.any(Object),
        toolChoice: 'auto',
      })
    )
  })
})

