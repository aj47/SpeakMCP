import { describe, it, expect, vi, beforeEach } from 'vitest'

const makeLLMCallWithFetchMock = vi.fn()

vi.mock('./config', () => ({
  configStore: {
    get: () => ({
      mcpToolsProviderId: 'gemini',
      mcpToolsSystemPrompt: '',
      mcpCustomSystemPrompt: '',
      mcpVerifyCompletionEnabled: false,
      mcpVerifyRetryCount: 0,
      mcpVerifyContextMaxItems: 10,
      mcpParallelToolExecution: false,
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
  isDebugTools: () => false,
  logTools: vi.fn(),
}))

vi.mock('./system-prompts', () => ({
  constructSystemPrompt: () => 'SYSTEM_PROMPT',
}))

vi.mock('./structured-output', () => ({
  makeStructuredContextExtraction: vi.fn().mockResolvedValue({ contextSummary: '', resources: [] }),
}))

vi.mock('./context-budget', () => ({
  shrinkMessagesForLLM: vi.fn(async ({ messages }: any) => ({ messages })),
}))

vi.mock('./emit-agent-progress', () => ({
  emitAgentProgress: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./agent-session-tracker', () => ({
  agentSessionTracker: {
    isSessionSnoozed: () => false,
    getSession: () => ({ conversationTitle: 'Test' }),
  },
}))

vi.mock('./state', () => ({
  state: {
    shouldStopAgent: false,
    isAgentModeActive: false,
    agentIterationCount: 0,
  },
  agentSessionStateManager: {
    createSession: vi.fn(),
    cleanupSession: vi.fn(),
    shouldStopSession: vi.fn(() => false),
    updateIterationCount: vi.fn(),
    registerAbortController: vi.fn(),
    unregisterAbortController: vi.fn(),
  },
}))

vi.mock('./llm-fetch', () => ({
  makeLLMCallWithFetch: (...args: any[]) => makeLLMCallWithFetchMock(...args),
  makeTextCompletionWithFetch: vi.fn(),
  verifyCompletionWithFetch: vi.fn(),
  makeLLMCallWithStreaming: vi.fn(),
}))

describe('Agent completion summary context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes intermediate tool calls in summary-generation prompt even when assistant content is empty', async () => {
    const toolA = { name: 'toolA', arguments: { foo: 'bar' } }
    const toolB = { name: 'toolB', arguments: { baz: 1 } }

    makeLLMCallWithFetchMock
      .mockResolvedValueOnce({ content: '', toolCalls: [toolA], needsMoreWork: true })
      .mockResolvedValueOnce({ content: '', toolCalls: [toolB], needsMoreWork: false })
      .mockResolvedValueOnce({ content: 'Summary text', needsMoreWork: false })
      .mockResolvedValueOnce({ content: 'Post-verify summary', needsMoreWork: false })

    const { processTranscriptWithAgentMode } = await import('./llm')

    await processTranscriptWithAgentMode(
      'Do a thing',
      [],
      async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
      3,
      undefined,
      undefined,
      undefined,
      undefined,
    )

    const summaryPrompt =
      'Please provide a concise summary of what you just accomplished with the tool calls.'

    const summaryCall = makeLLMCallWithFetchMock.mock.calls.find(([messages]) =>
      (messages as any[]).some((m) => m.role === 'user' && String(m.content).includes(summaryPrompt))
    )

    expect(summaryCall).toBeTruthy()

    const summaryMessages = summaryCall?.[0] as Array<{ role: string; content: string }>
    const combined = summaryMessages.map((m) => `${m.role}: ${m.content}`).join('\n')

    expect(combined).toContain('Tool calls:')
    expect(combined).toContain('- toolA(')
    expect(combined).toContain('args keys: foo')
    expect(combined).toContain('values redacted')
    expect(combined).not.toContain('{"foo":"bar"}')
    expect(combined).toContain('- toolB(')
    expect(combined).toContain('args keys: baz')
    expect(combined).not.toContain('{"baz":1}')
  })
})

