import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { ConversationService } from '../main/conversation-service'
import { Conversation } from '../shared/types'

// Mock the config module
const mockConversationsFolder = path.join(__dirname, 'test-conversations')

// Mock the config import
vi.mock('../main/config', () => ({
  conversationsFolder: mockConversationsFolder
}))

describe('ConversationService', () => {
  let conversationService: ConversationService
  
  beforeEach(() => {
    // Clean up test folder
    if (fs.existsSync(mockConversationsFolder)) {
      fs.rmSync(mockConversationsFolder, { recursive: true, force: true })
    }
    
    // Get fresh instance
    conversationService = ConversationService.getInstance()
  })
  
  afterEach(() => {
    // Clean up test folder
    if (fs.existsSync(mockConversationsFolder)) {
      fs.rmSync(mockConversationsFolder, { recursive: true, force: true })
    }
  })
  
  describe('createConversation', () => {
    it('should create a new conversation with a user message', async () => {
      const firstMessage = "Hello, this is a test message"
      
      const conversation = await conversationService.createConversation(firstMessage, "user")
      
      expect(conversation).toBeDefined()
      expect(conversation.id).toMatch(/^conv_\d+_[a-z0-9]+$/)
      expect(conversation.title).toBe(firstMessage)
      expect(conversation.messages).toHaveLength(1)
      expect(conversation.messages[0].content).toBe(firstMessage)
      expect(conversation.messages[0].role).toBe("user")
      expect(conversation.createdAt).toBeGreaterThan(0)
      expect(conversation.updatedAt).toBeGreaterThan(0)
    })
    
    it('should truncate long titles', async () => {
      const longMessage = "This is a very long message that should be truncated when used as a title because it exceeds the maximum length limit"
      
      const conversation = await conversationService.createConversation(longMessage, "user")
      
      expect(conversation.title).toBe("This is a very long message that should be truncat...")
      expect(conversation.title.length).toBeLessThanOrEqual(53) // 50 chars + "..."
    })
  })
  
  describe('saveConversation and loadConversation', () => {
    it('should save and load a conversation', async () => {
      const conversation = await conversationService.createConversation("Test message", "user")
      
      // Load the conversation
      const loadedConversation = await conversationService.loadConversation(conversation.id)
      
      expect(loadedConversation).toBeDefined()
      expect(loadedConversation!.id).toBe(conversation.id)
      expect(loadedConversation!.title).toBe(conversation.title)
      expect(loadedConversation!.messages).toHaveLength(1)
      expect(loadedConversation!.messages[0].content).toBe("Test message")
    })
    
    it('should return null for non-existent conversation', async () => {
      const result = await conversationService.loadConversation("non-existent-id")
      expect(result).toBeNull()
    })
  })
  
  describe('addMessageToConversation', () => {
    it('should add a message to an existing conversation', async () => {
      const conversation = await conversationService.createConversation("First message", "user")
      
      const updatedConversation = await conversationService.addMessageToConversation(
        conversation.id,
        "Second message",
        "assistant"
      )
      
      expect(updatedConversation).toBeDefined()
      expect(updatedConversation!.messages).toHaveLength(2)
      expect(updatedConversation!.messages[1].content).toBe("Second message")
      expect(updatedConversation!.messages[1].role).toBe("assistant")
      expect(updatedConversation!.updatedAt).toBeGreaterThan(conversation.updatedAt)
    })
    
    it('should return null for non-existent conversation', async () => {
      const result = await conversationService.addMessageToConversation(
        "non-existent-id",
        "Test message",
        "user"
      )
      expect(result).toBeNull()
    })
  })
  
  describe('getConversationHistory', () => {
    it('should return empty array when no conversations exist', async () => {
      const history = await conversationService.getConversationHistory()
      expect(history).toEqual([])
    })
    
    it('should return conversation history sorted by updatedAt', async () => {
      // Create multiple conversations with delays to ensure different timestamps
      const conv1 = await conversationService.createConversation("First conversation", "user")
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const conv2 = await conversationService.createConversation("Second conversation", "user")
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Update first conversation to make it more recent
      await conversationService.addMessageToConversation(conv1.id, "Updated message", "assistant")
      
      const history = await conversationService.getConversationHistory()
      
      expect(history).toHaveLength(2)
      expect(history[0].id).toBe(conv1.id) // Most recently updated should be first
      expect(history[1].id).toBe(conv2.id)
      expect(history[0].messageCount).toBe(2)
      expect(history[1].messageCount).toBe(1)
    })
  })
  
  describe('deleteConversation', () => {
    it('should delete a conversation and update index', async () => {
      const conversation = await conversationService.createConversation("Test message", "user")
      
      // Verify conversation exists
      let history = await conversationService.getConversationHistory()
      expect(history).toHaveLength(1)
      
      // Delete conversation
      await conversationService.deleteConversation(conversation.id)
      
      // Verify conversation is deleted
      history = await conversationService.getConversationHistory()
      expect(history).toHaveLength(0)
      
      const loadedConversation = await conversationService.loadConversation(conversation.id)
      expect(loadedConversation).toBeNull()
    })
  })
  
  describe('deleteAllConversations', () => {
    it('should delete all conversations', async () => {
      // Create multiple conversations
      await conversationService.createConversation("First", "user")
      await conversationService.createConversation("Second", "user")
      await conversationService.createConversation("Third", "user")
      
      let history = await conversationService.getConversationHistory()
      expect(history).toHaveLength(3)
      
      // Delete all
      await conversationService.deleteAllConversations()
      
      history = await conversationService.getConversationHistory()
      expect(history).toHaveLength(0)
    })
  })
})
