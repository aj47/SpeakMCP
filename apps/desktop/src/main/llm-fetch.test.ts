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
  llmRequestAbortManager: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}))

describe('LLM Fetch Retry Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('should treat 524 Gateway Timeout as retryable HttpError', async () => {
    // Mock a 524 response
    const mockResponse = {
      ok: false,
      status: 524,
      statusText: 'Gateway Timeout',
      text: async () => '<html><body>Cloudflare 524 Gateway Timeout</body></html>',
      json: async () => ({}),
    }

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount <= 2) {
        return Promise.resolve(mockResponse)
      }
      // Third attempt succeeds
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"content": "Success after retry"}',
              },
            },
          ],
        }),
      })
    })

    // Import the function after mocks are set up
    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    // Should have retried and eventually succeeded
    expect(callCount).toBe(3)
    expect(result.content).toBe('Success after retry')
  })

  it('should not treat 524 error with json keyword as structured output error', async () => {
    // Mock a 524 response with "json" in the error text
    const mockResponse = {
      ok: false,
      status: 524,
      statusText: 'Gateway Timeout',
      text: async () =>
        '<html><body>Cloudflare 524 Gateway Timeout. Expected JSON response.</body></html>',
      json: async () => ({}),
    }

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve(mockResponse)
      }
      // Second attempt succeeds
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"content": "Success"}',
              },
            },
          ],
        }),
      })
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    // Should have retried (not treated as structured output error)
    expect(callCount).toBe(2)
    expect(result.content).toBe('Success')
  })

  it('should treat 400 error with json_schema keyword as structured output error and fallback', async () => {
    // Mock a 400 response with structured output error
    const mockResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () =>
        'Invalid request: json_schema is not supported for this model',
      json: async () => ({}),
    }

    global.fetch = vi.fn().mockResolvedValue(mockResponse)

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    // Should throw after trying all fallback modes
    await expect(
      makeLLMCallWithFetch([{ role: 'user', content: 'test' }], 'openai')
    ).rejects.toThrow()

    // Should try JSON Schema, JSON Object, and Plain text modes (3 attempts)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('should retry on 502 Bad Gateway', async () => {
    const mockResponse = {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'Bad Gateway',
      json: async () => ({}),
    }

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve(mockResponse)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"content": "Success"}',
              },
            },
          ],
        }),
      })
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(callCount).toBe(2)
    expect(result.content).toBe('Success')
  })

  it('should retry on 503 Service Unavailable', async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Service Unavailable',
      json: async () => ({}),
    }

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve(mockResponse)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"content": "Success"}',
              },
            },
          ],
        }),
      })
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(callCount).toBe(2)
    expect(result.content).toBe('Success')
  })
})

describe('Continuation Phrase Detection (Issue #443)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('should set needsMoreWork=true when response contains "Let me"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Let me navigate to the correct directory and start the agent.',
            },
          },
        ],
      }),
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toContain('Let me navigate')
    expect(result.needsMoreWork).toBe(true)
  })

  it('should set needsMoreWork=true when response contains "I\'ll"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "I'll check the file and fix the issue.",
            },
          },
        ],
      }),
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toContain("I'll check")
    expect(result.needsMoreWork).toBe(true)
  })

  it('should set needsMoreWork=true when response contains "I will"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'I will now proceed to update the configuration.',
            },
          },
        ],
      }),
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toContain('I will now')
    expect(result.needsMoreWork).toBe(true)
  })

  it('should set needsMoreWork=true when response contains "going to"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "I'm going to run the tests now.",
            },
          },
        ],
      }),
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toContain('going to')
    expect(result.needsMoreWork).toBe(true)
  })

  it('should set needsMoreWork=undefined for plain text without continuation phrases', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'The task has been completed successfully.',
            },
          },
        ],
      }),
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toContain('completed successfully')
    expect(result.needsMoreWork).toBeUndefined()
  })

  it('should set needsMoreWork=true when response contains "need to"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'I need to check the logs first.',
            },
          },
        ],
      }),
    })

    const { makeLLMCallWithFetch } = await import('./llm-fetch')

    const result = await makeLLMCallWithFetch(
      [{ role: 'user', content: 'test' }],
      'openai'
    )

    expect(result.content).toContain('need to')
    expect(result.needsMoreWork).toBe(true)
  })
})

