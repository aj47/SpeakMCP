import { describe, expect, it } from "vitest"

import { convertMessagesToAISDK, sanitizeToolName } from "./ai-sdk-message-utils"

describe("ai-sdk-message-utils", () => {
  describe("convertMessagesToAISDK", () => {
    it("pairs tool results by toolCallId (even when results are out of order)", () => {
      const { system, messages } = convertMessagesToAISDK(
        [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "doing",
            toolCalls: [
              { name: "a:one", arguments: { x: 1 }, toolCallId: "call1" },
              { name: "a:two", arguments: { y: 2 }, toolCallId: "call2" },
            ],
          },
          {
            role: "tool",
            content: "",
            toolResults: [
              { toolCallId: "call2", toolName: "a:two", content: "r2", success: true },
              { toolCallId: "call1", toolName: "a:one", content: "r1", success: true },
            ],
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      expect(system).toBeUndefined()

      const assistant = messages[1] as any
      const toolCallParts = assistant.content.filter((p: any) => p.type === "tool-call")
      expect(toolCallParts.map((p: any) => p.toolName)).toEqual([
        sanitizeToolName("a:one"),
        sanitizeToolName("a:two"),
      ])

      const toolMsg = messages[2] as any
      expect(toolMsg.role).toBe("tool")
      expect(toolMsg.content.map((p: any) => p.toolCallId)).toEqual(["call2", "call1"])
      expect(toolMsg.content.map((p: any) => p.toolName)).toEqual([
        sanitizeToolName("a:two"),
        sanitizeToolName("a:one"),
      ])
    })

    it("pairs tool results by position when toolCallId is missing", () => {
      const { messages } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { name: "s:one", arguments: {} },
              { name: "s:two", arguments: {} },
            ],
          },
          {
            role: "tool",
            content: "",
            toolResults: [
              { content: "r1", success: true },
              { content: "r2", success: true },
            ],
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      const assistant = messages[0] as any
      const toolCallParts = assistant.content.filter((p: any) => p.type === "tool-call")
      const ids = toolCallParts.map((p: any) => p.toolCallId)

      const toolMsg = messages[1] as any
      const resultIds = toolMsg.content.map((p: any) => p.toolCallId)

      expect(ids).toHaveLength(2)
      expect(resultIds).toEqual(ids)
    })

    it("synthesizes placeholder tool results when history is missing tool outputs", () => {
      const { messages } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ name: "x:tool", arguments: {}, toolCallId: "call_x" }],
          },
        ],
        {
          ensureEndsWithUserMessage: false,
          missingToolResultText: "MISSING_RESULT",
        },
      )

      expect(messages).toHaveLength(2)
      const toolMsg = messages[1] as any
      expect(toolMsg.role).toBe("tool")
      expect(toolMsg.content).toHaveLength(1)
      expect(toolMsg.content[0].toolCallId).toBe("call_x")
      expect(toolMsg.content[0].output).toEqual({
        type: "error-text",
        value: "MISSING_RESULT",
      })
    })

    it("converts orphan tool-role messages to user text (avoids orphan tool-result parts)", () => {
      const { messages } = convertMessagesToAISDK(
        [
          {
            role: "tool",
            content: "",
            toolResults: [{ toolCallId: "call_1", toolName: "foo", content: "bar", success: true }],
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      expect(messages).toEqual([{ role: "user", content: "[foo] bar" }])
    })

    it("uses provided tool-name mapping to keep history consistent with provider tool names", () => {
      const mapping = new Map<string, string>([
        ["playwright:browser_navigate", "playwright__COLON__browser_navigate"],
      ])

      const { messages } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                name: "playwright:browser_navigate",
                arguments: { url: "https://example.com" },
                toolCallId: "call_nav",
              },
            ],
          },
          {
            role: "tool",
            content: "",
            toolResults: [
              {
                toolCallId: "call_nav",
                toolName: "playwright:browser_navigate",
                content: "ok",
                success: true,
              },
            ],
          },
        ],
        { ensureEndsWithUserMessage: false, originalToolNameToProviderToolName: mapping },
      )

      const assistant = messages[0] as any
      const toolCallPart = assistant.content.find((p: any) => p.type === "tool-call")
      expect(toolCallPart.toolName).toBe("playwright__COLON__browser_navigate")

      const toolMsg = messages[1] as any
      expect(toolMsg.content[0].toolName).toBe("playwright__COLON__browser_navigate")
    })

    it("appends a user continuation message when history ends with an assistant message (prefill fix)", () => {
      const { messages } = convertMessagesToAISDK([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Working on it." },
      ])

      expect(messages[messages.length - 1].role).toBe("user")
      expect((messages[messages.length - 1] as any).content).toContain(
        "Continue from your most recent step",
      )
    })

    it("pairs mismatched toolCallId to pending calls by position when unresolved calls exist", () => {
      const { messages } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { name: "tool:a", arguments: {}, toolCallId: "call_a" },
              { name: "tool:b", arguments: {}, toolCallId: "call_b" },
            ],
          },
          {
            role: "tool",
            content: "",
            toolResults: [
              // Result with mismatched toolCallId should fall back to positional pairing
              { toolCallId: "call_wrong", toolName: "tool:a", content: "result_a", success: true },
              { toolCallId: "call_b", toolName: "tool:b", content: "result_b", success: true },
            ],
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      const assistant = messages[0] as any
      const toolCallParts = assistant.content.filter((p: any) => p.type === "tool-call")
      const callIds = toolCallParts.map((p: any) => p.toolCallId)

      const toolMsg = messages[1] as any
      expect(toolMsg.role).toBe("tool")
      expect(toolMsg.content).toHaveLength(2)
      // First result should be paired to call_a (by position, since call_wrong doesn't match)
      expect(toolMsg.content[0].toolCallId).toBe(callIds[0])
      expect(toolMsg.content[0].toolName).toBe(sanitizeToolName("tool:a"))
      // Second result should be paired to call_b (by exact match)
      expect(toolMsg.content[1].toolCallId).toBe("call_b")
      expect(toolMsg.content[1].toolName).toBe(sanitizeToolName("tool:b"))
    })

    it("detects error indicators in legacy tool messages and emits error-text output", () => {
      const { messages: messagesWithError } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ name: "tool:test", arguments: {}, toolCallId: "call_1" }],
          },
          {
            role: "tool",
            content: "ERROR: Something went wrong",
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      const toolMsg = messagesWithError[1] as any
      expect(toolMsg.role).toBe("tool")
      expect(toolMsg.content[0].output).toEqual({
        type: "error-text",
        value: "ERROR: Something went wrong",
      })

      // Test with TOOL FAILED prefix
      const { messages: messagesWithFailed } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ name: "tool:test", arguments: {}, toolCallId: "call_2" }],
          },
          {
            role: "tool",
            content: "TOOL FAILED: Connection timeout",
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      const toolMsg2 = messagesWithFailed[1] as any
      expect(toolMsg2.content[0].output).toEqual({
        type: "error-text",
        value: "TOOL FAILED: Connection timeout",
      })

      // Test with normal content (should be text, not error-text)
      const { messages: messagesNormal } = convertMessagesToAISDK(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ name: "tool:test", arguments: {}, toolCallId: "call_3" }],
          },
          {
            role: "tool",
            content: "Successfully completed the task",
          },
        ],
        { ensureEndsWithUserMessage: false },
      )

      const toolMsg3 = messagesNormal[1] as any
      expect(toolMsg3.content[0].output).toEqual({
        type: "text",
        value: "Successfully completed the task",
      })
    })
  })
})

