import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentStepSummary } from "@shared/types"

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
}))

// Avoid importing the real configStore (it touches disk + electron paths at module init).
vi.mock("./config", () => ({
  configStore: {
    get: () => ({
      dualModelEnabled: false,
      modelPresets: [],
    }),
  },
}))

vi.mock("./debug", () => ({
  isDebugLLM: () => false,
  logLLM: vi.fn(),
}))

// Not directly used by the units we test here, but summarization-service imports them.
vi.mock("ai", () => ({
  generateText: vi.fn(),
}))

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn(() => ({})),
  })),
}))

describe("parseSummaryResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("extracts and sanitizes memoryCandidates (single-line, max 5)", async () => {
    const { parseSummaryResponse } = await import("./summarization-service")

    const input = {
      sessionId: "sess_1",
      stepNumber: 1,
      assistantResponse: "ok",
    }

    const response = JSON.stringify({
      actionSummary: "did stuff",
      keyFindings: [],
      nextSteps: "",
      decisionsMade: [],
      memoryCandidates: [
        "preference:  user likes  pnpm\nand hates npm",
        123,
        "",
        "constraint:  don't run installs  without permission",
        "fact: repo uses tipc",
        "insight:    memory candidates reduce bloat",
      ],
      importance: "high",
    })

    const summary = parseSummaryResponse(response, input as any)

    expect(summary.actionSummary).toBe("did stuff")
    expect(summary.importance).toBe("high")
    expect(summary.memoryCandidates).toEqual([
      "preference: user likes pnpm and hates npm",
      "constraint: don't run installs without permission",
      "fact: repo uses tipc",
      "insight: memory candidates reduce bloat",
    ])
  })

  it("truncates memoryCandidates to 240 chars", async () => {
    const { parseSummaryResponse } = await import("./summarization-service")

    const long = `fact: ${"a".repeat(500)}`
    const response = JSON.stringify({
      actionSummary: "x",
      memoryCandidates: [long],
      importance: "medium",
    })

    const summary = parseSummaryResponse(response, { sessionId: "s", stepNumber: 1 } as any)
    expect(summary.memoryCandidates).toHaveLength(1)
    expect(summary.memoryCandidates?.[0]).toHaveLength(240)
    expect(summary.memoryCandidates?.[0].startsWith("fact: ")).toBe(true)
  })

  it("returns empty memoryCandidates on parse failure", async () => {
    const { parseSummaryResponse } = await import("./summarization-service")

    const summary = parseSummaryResponse("not json", {
      sessionId: "sess",
      stepNumber: 2,
      assistantResponse: "hello world",
    } as any)

    expect(summary.memoryCandidates).toEqual([])
    expect(summary.actionSummary).toBe("hello world")
    expect(summary.importance).toBe("medium")
  })
})

describe("MemoryService.createMemoryFromSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("returns null when there are no durable fields", async () => {
    const { memoryService } = await import("./memory-service")

    const summary: AgentStepSummary = {
      id: "summary_1",
      sessionId: "sess",
      stepNumber: 1,
      timestamp: Date.now(),
      actionSummary: "ran tools",
      importance: "medium",
    }

    expect(memoryService.createMemoryFromSummary(summary)).toBeNull()
  })

  it("filters out candidates without allowed type prefixes", async () => {
    const { memoryService } = await import("./memory-service")

    const summary: AgentStepSummary = {
      id: "summary_prefix",
      sessionId: "sess",
      stepNumber: 3,
      timestamp: Date.now(),
      actionSummary: "ran tools",
      importance: "medium",
      memoryCandidates: [
        "preference: use pnpm",
        "telemetry: ran 5 tools",
        "random noise without colon",
        "fact:",
        "constraint",
        "insight:   ",
        "fact: repo uses vitest",
      ],
    }

    const memory = memoryService.createMemoryFromSummary(summary)
    expect(memory).not.toBeNull()
    expect(memory?.content).toBe("preference: use pnpm | fact: repo uses vitest")
  })

  it("truncates fallback decisionsMade/keyFindings to 240 chars per item", async () => {
    const { memoryService } = await import("./memory-service")

    const longDecision = "a".repeat(500)
    const summary: AgentStepSummary = {
      id: "summary_trunc",
      sessionId: "sess",
      stepNumber: 4,
      timestamp: Date.now(),
      actionSummary: "ran tools",
      importance: "medium",
      decisionsMade: [longDecision],
    }

    const memory = memoryService.createMemoryFromSummary(summary)
    expect(memory).not.toBeNull()
    expect(memory?.content).toHaveLength(240)
  })

  it("prefers memoryCandidates and derives tags", async () => {
    const { memoryService } = await import("./memory-service")

    const summary: AgentStepSummary = {
      id: "summary_2",
      sessionId: "sess",
      stepNumber: 2,
      timestamp: Date.now(),
      actionSummary: "ran tools",
      importance: "high",
      tags: ["existing"],
      decisionsMade: ["decision a"],
      keyFindings: ["finding a"],
      memoryCandidates: [
        "preference: use pnpm",
        "constraint:  don't run installs without permission",
        "fact: repo uses tipc",
        "insight: should be ignored (only first 3 candidates used)",
      ],
    }

    const memory = memoryService.createMemoryFromSummary(summary, undefined, undefined, ["manual"])
    expect(memory).not.toBeNull()

    expect(memory?.content).toBe(
      "preference: use pnpm | constraint: don't run installs without permission | fact: repo uses tipc",
    )
    expect(memory?.tags).toEqual(["existing", "manual", "preference", "constraint", "fact"])
    expect(memory?.importance).toBe("high")
  })
})
