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
    isSessionRegistered: () => false,
    shouldStopSession: () => false,
    registerAbortController: vi.fn(),
    unregisterAbortController: vi.fn(),
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
  getCurrentModelName: vi.fn(() => 'gpt-4o-mini'),
}))

// Mock the langfuse-service module
vi.mock('./langfuse-service', () => ({
  isLangfuseEnabled: vi.fn(() => false),
  createLLMGeneration: vi.fn(() => null),
  endLLMGeneration: vi.fn(),
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
    // When there are no tool calls and no JSON, needsMoreWork is undefined
    // to let the agent loop decide whether to continue or nudge for proper format
    expect(result.needsMoreWork).toBeUndefined()
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
          input: { word: 'hello' },
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

  it('should correctly restore tool names with colons from MCP server prefixes', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    // Mock a response with a tool call using sanitized name (colon replaced with __COLON__)
    generateTextMock.mockResolvedValue({
      text: 'Navigating to the page.',
      finishReason: 'tool-calls',
      usage: { promptTokens: 10, completionTokens: 20 },
      toolCalls: [
        {
          toolName: 'playwright__COLON__browser_navigate',
          input: { url: 'https://example.com' },
          toolCallId: 'call_456',
        },
      ],
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const mockTools = [
      {
        name: 'playwright:browser_navigate',
        description: 'Navigate to a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
        },
      },
    ]

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'go to example.com' }],
      'openai',
      undefined,
      undefined,
      mockTools
    )

    expect(result.toolCalls).toBeDefined()
    expect(result.toolCalls).toHaveLength(1)
    // The tool name should be restored to original format with colon
    expect(result.toolCalls![0].name).toBe('playwright:browser_navigate')
    expect(result.toolCalls![0].arguments).toEqual({ url: 'https://example.com' })
  })

  it('should not incorrectly restore tool names with double underscores that are not from sanitization', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    // Mock a response with a tool that legitimately has double underscores in its name
    generateTextMock.mockResolvedValue({
      text: 'Running the tool.',
      finishReason: 'tool-calls',
      usage: { promptTokens: 10, completionTokens: 20 },
      toolCalls: [
        {
          toolName: 'my__custom__tool',
          input: { param: 'value' },
          toolCallId: 'call_789',
        },
      ],
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const mockTools = [
      {
        name: 'my__custom__tool',
        description: 'A tool with double underscores in its name',
        inputSchema: {
          type: 'object',
          properties: {
            param: { type: 'string' },
          },
        },
      },
    ]

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'run the tool' }],
      'openai',
      undefined,
      undefined,
      mockTools
    )

    expect(result.toolCalls).toBeDefined()
    expect(result.toolCalls).toHaveLength(1)
    // The tool name should remain unchanged - double underscores are NOT replaced
    // because they are not the __COLON__ pattern
    expect(result.toolCalls![0].name).toBe('my__custom__tool')
    expect(result.toolCalls![0].arguments).toEqual({ param: 'value' })
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

  it('should retry on AI SDK structured errors with isRetryable flag', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    let callCount = 0
    generateTextMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Simulate AI SDK APICallError with structured fields
        const error = new Error('Server error') as any
        error.statusCode = 500
        error.isRetryable = true
        throw error
      }
      return Promise.resolve({
        text: '{"content": "Success after retry with structured error"}',
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
    expect(result.content).toBe('Success after retry with structured error')
  })

  it('should not retry on AI SDK structured errors with isRetryable=false', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    // Simulate AI SDK APICallError with isRetryable=false
    const error = new Error('Bad request') as any
    error.statusCode = 400
    error.isRetryable = false
    generateTextMock.mockRejectedValue(error)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    await expect(
      makeLLMCallWithFetch([{ role: 'user', content: 'test' }], 'openai')
    ).rejects.toThrow('Bad request')

    // Should not retry - called only once
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })

  it('should append user message when conversation ends with assistant message (prefill fix)', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    generateTextMock.mockResolvedValue({
      text: '{"content": "Continuing the work.", "needsMoreWork": false}',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    // Messages ending with an assistant message (the prefill scenario)
    await makeLLMCallWithFetch(
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Summarize X feed' },
        { role: 'assistant', content: 'I will start working on that.' },
      ],
      'openai'
    )

    // Verify that generateText was called with a continuation user message appended
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Summarize X feed' },
          { role: 'assistant', content: 'I will start working on that.' },
          { role: 'user', content: 'Continue from your most recent step using the existing context. Do not restart.' },
        ],
      })
    )
  })

  it('should not append user message when conversation already ends with user message', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)

    generateTextMock.mockResolvedValue({
      text: '{"content": "Here is the result.", "needsMoreWork": false}',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    } as any)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    // Messages ending with a user message (normal scenario)
    await makeLLMCallWithFetch(
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      'openai'
    )

    // Verify that generateText was called without an extra user message
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Hello' },
        ],
      })
    )
  })

  it('should retry on AI SDK rate limit errors (statusCode 429)', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    
    let callCount = 0
    generateTextMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Simulate AI SDK TooManyRequestsError
        const error = new Error('Rate limited') as any
        error.statusCode = 429
        throw error
      }
      return Promise.resolve({
        text: '{"content": "Success after rate limit retry"}',
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
    expect(result.content).toBe('Success after rate limit retry')
  })

  it('should not retry and throw "Session stopped by kill switch" when session stopped after API failure', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    const { agentSessionStateManager } = await import('./state')

    // Start with session not stopped; flip to stopped after first API call fails
    let sessionStopped = false
    const isRegisteredSpy = vi.spyOn(agentSessionStateManager, 'isSessionRegistered')
      .mockReturnValue(true)
    const shouldStopSpy = vi.spyOn(agentSessionStateManager, 'shouldStopSession')
      .mockImplementation(() => sessionStopped)

    let callCount = 0
    generateTextMock.mockImplementation(() => {
      callCount++
      sessionStopped = true // mark stopped so the catch block skips retry
      return Promise.reject(new Error('503 Service Unavailable'))
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    await expect(
      makeLLMCallWithFetch(
        [{ role: 'user', content: 'test' }],
        'openai',
        undefined,
        'test-session-id'
      )
    ).rejects.toThrow('Session stopped by kill switch')

    // Should be called exactly once (no retry attempted because session was stopped)
    expect(callCount).toBe(1)

    isRegisteredSpy.mockRestore()
    shouldStopSpy.mockRestore()
  })

  it('should throw "Session stopped by kill switch" (not API error) when stopped mid-retry', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    const { agentSessionStateManager } = await import('./state')

    const isRegisteredSpy = vi.spyOn(agentSessionStateManager, 'isSessionRegistered')
      .mockReturnValue(true)
    const shouldStopSpy = vi.spyOn(agentSessionStateManager, 'shouldStopSession')
      .mockReturnValue(true)

    const apiError = new Error('503 Service Unavailable')
    generateTextMock.mockRejectedValue(apiError)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    await expect(
      makeLLMCallWithFetch(
        [{ role: 'user', content: 'test' }],
        'openai',
        undefined,
        'test-session-id'
      )
    ).rejects.toThrow('Session stopped by kill switch')

    // withRetry checks session stop at the top of each loop iteration,
    // so when session is already stopped, the API is never even called.
    expect(generateTextMock).toHaveBeenCalledTimes(0)

    isRegisteredSpy.mockRestore()
    shouldStopSpy.mockRestore()
  })

  it('should interrupt backoff delay and throw "Session stopped by kill switch" when session stopped during wait', async () => {
    const { generateText } = await import('ai')
    const generateTextMock = vi.mocked(generateText)
    const { agentSessionStateManager } = await import('./state')

    // Session stop is triggered after the first API failure, during backoff wait
    let sessionStopped = false
    const isRegisteredSpy = vi.spyOn(agentSessionStateManager, 'isSessionRegistered')
      .mockReturnValue(true)
    const shouldStopSpy = vi.spyOn(agentSessionStateManager, 'shouldStopSession')
      .mockImplementation(() => sessionStopped)

    let callCount = 0
    generateTextMock.mockImplementation(() => {
      callCount++
      // Trigger session stop after the first failure so interruptibleDelay sees it
      setTimeout(() => { sessionStopped = true }, 50)
      return Promise.reject(new Error('503 Service Unavailable'))
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    // The call should reject with a session-stop error, not the API error,
    // even though the stop was triggered during the backoff delay
    await expect(
      makeLLMCallWithFetch(
        [{ role: 'user', content: 'test' }],
        'openai',
        undefined,
        'test-session-id'
      )
    ).rejects.toThrow('Session stopped by kill switch')

    // Only one API call should have been made (backoff was interrupted before retry)
    expect(callCount).toBe(1)

    isRegisteredSpy.mockRestore()
    shouldStopSpy.mockRestore()
  })
})
