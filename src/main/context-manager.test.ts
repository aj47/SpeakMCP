import { SimpleContextManager, Message } from "./context-manager"

describe("SimpleContextManager", () => {
  let contextManager: SimpleContextManager

  beforeEach(() => {
    // Create a context manager with a small limit for testing
    contextManager = new SimpleContextManager(1000) // 1000 tokens limit
  })

  test("should not compress when under token limit", async () => {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" }
    ]

    const result = await contextManager.manageContext(messages)
    expect(result).toEqual(messages)
  })

  test("should compress when over token limit", async () => {
    // Create messages that exceed the token limit
    const longContent = "This is a very long message that should exceed the token limit. ".repeat(50)
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: "Recent message" },
      { role: "assistant", content: "Recent response" }
    ]

    const result = await contextManager.manageContext(messages)
    
    // Should have fewer messages after compression
    expect(result.length).toBeLessThan(messages.length)
    
    // Should preserve system message
    expect(result[0].role).toBe("system")
    
    // Should preserve recent messages
    const lastMessage = result[result.length - 1]
    expect(lastMessage.content).toBe("Recent response")
  })

  test("should identify critical messages", async () => {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Create a session with id: session-123" },
      { role: "assistant", content: "Session created successfully" },
      { role: "user", content: "Some regular message" },
      { role: "assistant", content: "Regular response" },
      { role: "user", content: "Error occurred in the process" },
      { role: "assistant", content: "I'll help you fix that error" }
    ]

    // Mock the summarizeMessages method to avoid actual LLM calls in tests
    const originalSummarize = (contextManager as any).summarizeMessages
    ;(contextManager as any).summarizeMessages = jest.fn().mockResolvedValue({
      role: "assistant",
      content: "[CONTEXT SUMMARY] Session session-123 was created. An error occurred and was addressed.",
      timestamp: Date.now()
    })

    const result = await contextManager.manageContext(messages)
    
    // Should preserve system message
    expect(result[0].role).toBe("system")
    
    // Should have a summary
    const summaryMessage = result.find(msg => msg.content.includes("[CONTEXT SUMMARY]"))
    expect(summaryMessage).toBeDefined()
    expect(summaryMessage?.content).toContain("session-123")
    expect(summaryMessage?.content).toContain("error")

    // Restore original method
    ;(contextManager as any).summarizeMessages = originalSummarize
  })

  test("should handle empty message list", async () => {
    const messages: Message[] = []
    const result = await contextManager.manageContext(messages)
    expect(result).toEqual([])
  })

  test("should handle only system message", async () => {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." }
    ]
    const result = await contextManager.manageContext(messages)
    expect(result).toEqual(messages)
  })
})
