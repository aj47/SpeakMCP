import { describe, it, expect, vi, beforeEach } from "vitest"

// Keep this test focused: we mock most main-process dependencies so we can exercise
// the agent loop control flow deterministically.

vi.mock("./config", () => ({
  configStore: {
    get: () => ({
      // Critical toggle for this regression
      mcpVerifyCompletionEnabled: false,

      // Minimal config to let processTranscriptWithAgentMode initialize
      mcpToolsProviderId: "openai",
      mcpToolsSystemPrompt: "",
      dualModelInjectMemories: false,
      dualModelAutoSaveImportant: false,
      memoriesEnabled: false,

      // Used for model info display (we mock getCurrentPresetName anyway)
      currentModelPresetId: "test",
      modelPresets: [],
    }),
  },
}))

vi.mock("./debug", () => ({
  isDebugLLM: () => false,
  isDebugTools: () => false,
  logLLM: vi.fn(),
  logTools: vi.fn(),
}))

vi.mock("./diagnostics", () => ({
  diagnosticsService: {
    logError: vi.fn(),
    logWarning: vi.fn(),
    logInfo: vi.fn(),
  },
}))

vi.mock("./emit-agent-progress", () => ({
  emitAgentProgress: vi.fn(() => Promise.resolve()),
}))

vi.mock("./agent-session-tracker", () => ({
  agentSessionTracker: {
    isSessionSnoozed: () => false,
    getSession: () => undefined,
  },
}))

vi.mock("./conversation-service", () => ({
  conversationService: {
    addMessageToConversation: vi.fn(),
  },
}))

vi.mock("./langfuse-service", () => ({
  isLangfuseEnabled: vi.fn(() => false),
  createAgentTrace: vi.fn(),
  endAgentTrace: vi.fn(),
  flushLangfuse: vi.fn(async () => {}),
}))

vi.mock("./summarization-service", () => ({
  isSummarizationEnabled: () => false,
  shouldSummarizeStep: () => false,
  summarizeAgentStep: vi.fn(),
  summarizationService: {
    getSummaries: () => [],
    getLatestSummary: () => null,
    addSummary: vi.fn(),
  },
}))

vi.mock("./memory-service", () => ({
  memoryService: {
    getMemoriesByProfile: vi.fn(async () => []),
    getAllMemories: vi.fn(async () => []),
    createMemoryFromSummary: vi.fn(() => null),
    saveMemory: vi.fn(async () => {}),
  },
}))

vi.mock("./session-user-response-store", () => ({
  clearSessionUserResponse: vi.fn(),
  getSessionUserResponse: vi.fn(() => undefined),
}))

vi.mock("./skills-service", () => ({
  skillsService: {
    getEnabledSkillsInstructionsForProfile: vi.fn(() => ""),
  },
}))

vi.mock("./system-prompts", () => ({
  constructSystemPrompt: vi.fn(() => "(system prompt)"),
}))

vi.mock("./context-budget", () => ({
  shrinkMessagesForLLM: vi.fn(async ({ messages }: { messages: any[] }) => ({
    messages,
    estTokensAfter: 0,
    maxTokens: 8192,
  })),
  estimateTokensFromMessages: vi.fn(() => 0),
}))

vi.mock("../shared", () => ({
  getCurrentPresetName: vi.fn(() => "Test Provider"),
}))

vi.mock("./state", () => ({
  state: {},
  agentSessionStateManager: {
    shouldStopSession: () => false,
    getSessionProfileSnapshot: () => undefined,
    createSession: vi.fn(),
    updateIterationCount: vi.fn(),
    cleanupSession: vi.fn(),
    registerAbortController: vi.fn(),
    unregisterAbortController: vi.fn(),
  },
}))

vi.mock("./llm-fetch", () => ({
  makeLLMCallWithFetch: vi.fn(),
  // In agent mode, llm.ts will often run a parallel streaming call for display.
  // It must return a Promise so llm.ts can safely call `.catch()` on it.
  makeLLMCallWithStreaming: vi.fn(async () => ({ content: "" })),
  makeTextCompletionWithFetch: vi.fn(),
  verifyCompletionWithFetch: vi.fn(),
}))

describe("processTranscriptWithAgentMode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("does not exit early with incomplete fallback when verification is disabled and the model returns a short progress update", async () => {
    const { makeLLMCallWithFetch } = await import("./llm-fetch")
    const makeLLMCallWithFetchMock = vi.mocked(makeLLMCallWithFetch)

    makeLLMCallWithFetchMock
      .mockResolvedValueOnce({ content: "Let me read your notes..." } as any)
      .mockResolvedValueOnce({ content: "Here's the summary you asked for." } as any)

    const { processTranscriptWithAgentMode } = await import("./llm")

    const result = await processTranscriptWithAgentMode(
      "Summarize these notes",
      [{ name: "dummy_tool", description: "Dummy", inputSchema: {} }],
      vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], isError: false })),
      5,
      undefined,
      undefined,
      "test-session",
    )

    expect(makeLLMCallWithFetchMock).toHaveBeenCalledTimes(2)
    expect(result.content).toBe("Here's the summary you asked for.")
    expect(result.content).not.toContain("I couldn't complete the request")
  })
})
