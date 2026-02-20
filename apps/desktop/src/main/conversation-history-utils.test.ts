import { describe, it, expect } from "vitest"
import {
  filterEphemeralMessages,
  isEphemeralMessage,
  type ConversationMessage,
} from "./conversation-history-utils"

describe("conversation-history-utils", () => {
  describe("filterEphemeralMessages", () => {
    it("should remove ephemeral messages from history", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Hello",
          timestamp: 1000,
        },
        {
          role: "assistant",
          content: "Hi there",
          timestamp: 2000,
        },
        {
          role: "user",
          content: "Internal nudge",
          timestamp: 3000,
          ephemeral: true,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].content).toBe("Hello")
      expect(filtered[1].content).toBe("Hi there")
    })

    it("should strip ephemeral field from returned messages", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Test",
          timestamp: 1000,
          ephemeral: false,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(1)
      expect("ephemeral" in filtered[0]).toBe(false)
    })

    it("should preserve all non-ephemeral messages", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Message 1",
          timestamp: 1000,
        },
        {
          role: "assistant",
          content: "Response 1",
          timestamp: 2000,
        },
        {
          role: "tool",
          content: "Tool result",
          timestamp: 3000,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(3)
      expect(filtered.map((m) => m.content)).toEqual([
        "Message 1",
        "Response 1",
        "Tool result",
      ])
    })

    it("should preserve toolCalls and toolResults", () => {
      const history: ConversationMessage[] = [
        {
          role: "assistant",
          content: "Calling tool",
          timestamp: 1000,
          toolCalls: [
            {
              name: "test_tool",
              arguments: { arg: "value" },
            },
          ],
        },
        {
          role: "tool",
          content: "Tool output",
          timestamp: 2000,
          toolResults: [
            {
              success: true,
              content: "Result",
            },
          ],
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].toolCalls).toEqual([
        {
          name: "test_tool",
          arguments: { arg: "value" },
        },
      ])
      expect(filtered[1].toolResults).toEqual([
        {
          success: true,
          content: "Result",
        },
      ])
    })

    it("should handle empty history", () => {
      const history: ConversationMessage[] = []

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(0)
    })

    it("should handle history with only ephemeral messages", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Ephemeral 1",
          timestamp: 1000,
          ephemeral: true,
        },
        {
          role: "user",
          content: "Ephemeral 2",
          timestamp: 2000,
          ephemeral: true,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(0)
    })

    it("should handle mixed ephemeral and non-ephemeral messages", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Real message 1",
          timestamp: 1000,
        },
        {
          role: "user",
          content: "Ephemeral nudge",
          timestamp: 2000,
          ephemeral: true,
        },
        {
          role: "assistant",
          content: "Response",
          timestamp: 3000,
        },
        {
          role: "user",
          content: "Another ephemeral",
          timestamp: 4000,
          ephemeral: true,
        },
        {
          role: "user",
          content: "Real message 2",
          timestamp: 5000,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(3)
      expect(filtered.map((m) => m.content)).toEqual([
        "Real message 1",
        "Response",
        "Real message 2",
      ])
    })

    it("should preserve message order", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "First",
          timestamp: 1000,
        },
        {
          role: "user",
          content: "Ephemeral",
          timestamp: 2000,
          ephemeral: true,
        },
        {
          role: "user",
          content: "Second",
          timestamp: 3000,
        },
        {
          role: "user",
          content: "Another ephemeral",
          timestamp: 4000,
          ephemeral: true,
        },
        {
          role: "user",
          content: "Third",
          timestamp: 5000,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered.map((m) => m.content)).toEqual(["First", "Second", "Third"])
    })

    it("should handle messages with undefined ephemeral field", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Message without ephemeral field",
          timestamp: 1000,
        },
        {
          role: "user",
          content: "Message with ephemeral false",
          timestamp: 2000,
          ephemeral: false,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(2)
    })

    it("should handle complex toolResults structures", () => {
      const history: ConversationMessage[] = [
        {
          role: "tool",
          content: "Complex result",
          timestamp: 1000,
          toolResults: [
            {
              success: true,
              content: [
                {
                  type: "text",
                  text: "Result text",
                },
              ],
            },
          ],
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].toolResults).toEqual([
        {
          success: true,
          content: [
            {
              type: "text",
              text: "Result text",
            },
          ],
        },
      ])
    })
  })

  describe("isEphemeralMessage", () => {
    it("should return true for ephemeral messages", () => {
      const msg: ConversationMessage = {
        role: "user",
        content: "Ephemeral",
        ephemeral: true,
      }

      expect(isEphemeralMessage(msg)).toBe(true)
    })

    it("should return false for non-ephemeral messages", () => {
      const msg: ConversationMessage = {
        role: "user",
        content: "Regular",
      }

      expect(isEphemeralMessage(msg)).toBe(false)
    })

    it("should return false for messages with ephemeral: false", () => {
      const msg: ConversationMessage = {
        role: "user",
        content: "Regular",
        ephemeral: false,
      }

      expect(isEphemeralMessage(msg)).toBe(false)
    })

    it("should return false for messages with undefined ephemeral", () => {
      const msg: ConversationMessage = {
        role: "user",
        content: "Regular",
        ephemeral: undefined,
      }

      expect(isEphemeralMessage(msg)).toBe(false)
    })
  })

  describe("integration scenarios", () => {
    it("should handle internal completion nudge scenario", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Please complete this task",
          timestamp: 1000,
        },
        {
          role: "assistant",
          content: "I'll help with that",
          timestamp: 2000,
        },
        {
          role: "user",
          content:
            "If all requested work is complete, use speakmcp-settings:respond_to_user to tell the user the result, then call speakmcp-settings:mark_work_complete with a concise summary. Otherwise continue working and call more tools.",
          timestamp: 3000,
          ephemeral: true,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(2)
      expect(filtered.every((m) => !("ephemeral" in m))).toBe(true)
    })

    it("should handle multiple ephemeral nudges in sequence", () => {
      const history: ConversationMessage[] = [
        {
          role: "user",
          content: "Task 1",
          timestamp: 1000,
        },
        {
          role: "user",
          content: "Nudge 1",
          timestamp: 2000,
          ephemeral: true,
        },
        {
          role: "assistant",
          content: "Working on it",
          timestamp: 3000,
        },
        {
          role: "user",
          content: "Nudge 2",
          timestamp: 4000,
          ephemeral: true,
        },
        {
          role: "assistant",
          content: "Done",
          timestamp: 5000,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(3)
      expect(filtered.map((m) => m.content)).toEqual([
        "Task 1",
        "Working on it",
        "Done",
      ])
    })

    it("should preserve all metadata except ephemeral flag", () => {
      const history: ConversationMessage[] = [
        {
          role: "assistant",
          content: "Response with metadata",
          timestamp: 1000,
          toolCalls: [
            {
              name: "tool1",
              arguments: { key: "value" },
            },
          ],
          toolResults: [
            {
              success: true,
              content: "Success",
            },
          ],
          ephemeral: false,
        },
      ]

      const filtered = filterEphemeralMessages(history)

      expect(filtered).toHaveLength(1)
      const msg = filtered[0]
      expect(msg.role).toBe("assistant")
      expect(msg.content).toBe("Response with metadata")
      expect(msg.timestamp).toBe(1000)
      expect(msg.toolCalls).toBeDefined()
      expect(msg.toolResults).toBeDefined()
      expect("ephemeral" in msg).toBe(false)
    })
  })
})
