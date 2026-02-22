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
  })
})

