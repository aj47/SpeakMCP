import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// We'll dynamically import the service after stubbing the env
let ConversationService: typeof import('./conversation-service').ConversationService

describe('ConversationService', () => {
  let tempDir: string
  let conversationsFolder: string
  let service: InstanceType<typeof ConversationService>

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakmcp-conv-test-'))
    conversationsFolder = path.join(tempDir, 'conversations')
    
    // Stub the env before importing the module
    vi.stubEnv('SPEAKMCP_DATA_DIR', tempDir)
    
    // Reset module cache and re-import to get fresh singleton
    vi.resetModules()
    const module = await import('./conversation-service')
    ConversationService = module.ConversationService
    
    // Reset the singleton instance to ensure clean state
    ;(ConversationService as any).instance = null
    service = ConversationService.getInstance()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('createConversation', () => {
    it('should create a new conversation with auto-generated ID', async () => {
      const conversation = await service.createConversation('Hello, world!')
      
      expect(conversation.id).toBeDefined()
      expect(conversation.id).toMatch(/^conv_\d+_[a-z0-9]+$/)
      expect(conversation.title).toBe('Hello, world!')
      expect(conversation.messages).toHaveLength(1)
      expect(conversation.messages[0].role).toBe('user')
      expect(conversation.messages[0].content).toBe('Hello, world!')
      expect(conversation.createdAt).toBeDefined()
      expect(conversation.updatedAt).toBeDefined()
    })

    it('should generate title from first message (truncated at 50 chars)', async () => {
      const longMessage = 'This is a very long message that should be truncated to 50 characters for the title'
      const conversation = await service.createConversation(longMessage)
      
      expect(conversation.title).toBe('This is a very long message that should be truncat...')
    })

    it('should save conversation to disk', async () => {
      const conversation = await service.createConversation('Test message')
      
      const filePath = path.join(conversationsFolder, `${conversation.id}.json`)
      expect(fs.existsSync(filePath)).toBe(true)
      
      const savedData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      expect(savedData.id).toBe(conversation.id)
      expect(savedData.messages[0].content).toBe('Test message')
    })

    it('should update conversation index', async () => {
      const conversation = await service.createConversation('Test message')
      
      const indexPath = path.join(conversationsFolder, 'index.json')
      expect(fs.existsSync(indexPath)).toBe(true)
      
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      expect(index).toHaveLength(1)
      expect(index[0].id).toBe(conversation.id)
      expect(index[0].messageCount).toBe(1)
    })

    it('should allow creating conversation with assistant role', async () => {
      const conversation = await service.createConversation('I am the assistant', 'assistant')
      
      expect(conversation.messages[0].role).toBe('assistant')
    })
  })

  describe('createConversationWithId', () => {
    it('should create conversation with specific ID', async () => {
      const customId = 'my_custom_id_123'
      const conversation = await service.createConversationWithId(customId, 'Hello!')
      
      expect(conversation.id).toBe(customId)
      expect(conversation.messages[0].content).toBe('Hello!')
    })

    it('should reject IDs with path traversal sequences', async () => {
      const dangerousId = 'test/../../../etc/passwd'

      await expect(
        service.createConversationWithId(dangerousId, 'Hello!')
      ).rejects.toThrow('contains path separators or traversal sequences')
    })

    it('should reject IDs with null bytes', async () => {
      await expect(
        service.createConversationWithId('test\0id', 'Hello!')
      ).rejects.toThrow('contains null bytes')
    })

    it('should allow WhatsApp-style IDs with @ and .', async () => {
      const whatsappId = 'whatsapp_61406142826@s.whatsapp.net'
      const conversation = await service.createConversationWithId(whatsappId, 'Hello!')
      
      expect(conversation.id).toBe(whatsappId)
    })
  })

  describe('loadConversation', () => {
    it('should load existing conversation', async () => {
      const created = await service.createConversation('Test load')
      
      const loaded = await service.loadConversation(created.id)
      
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe(created.id)
      expect(loaded!.messages).toHaveLength(1)
    })

    it('should return null for non-existent conversation', async () => {
      const result = await service.loadConversation('non_existent_id')
      
      expect(result).toBeNull()
    })

    it('should return null for invalid JSON', async () => {
      // Create a malformed conversation file
      fs.mkdirSync(conversationsFolder, { recursive: true })
      fs.writeFileSync(path.join(conversationsFolder, 'bad.json'), 'not valid json')
      
      const result = await service.loadConversation('bad')
      
      expect(result).toBeNull()
    })
  })

  describe('saveConversation', () => {
    it('should save and update conversation', async () => {
      const conversation = await service.createConversation('Initial message')
      const originalUpdatedAt = conversation.updatedAt
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))
      
      conversation.title = 'Updated title'
      await service.saveConversation(conversation)
      
      const loaded = await service.loadConversation(conversation.id)
      expect(loaded!.title).toBe('Updated title')
      expect(loaded!.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('should preserve timestamp when preserveTimestamp is true', async () => {
      const conversation = await service.createConversation('Test')
      const originalUpdatedAt = conversation.updatedAt

      await new Promise(resolve => setTimeout(resolve, 10))

      await service.saveConversation(conversation, true)

      const loaded = await service.loadConversation(conversation.id)
      expect(loaded!.updatedAt).toBe(originalUpdatedAt)
    })
  })

  describe('getConversationHistory', () => {
    it('should return empty array when no conversations exist', async () => {
      const history = await service.getConversationHistory()

      expect(history).toEqual([])
    })

    it('should return list of all conversations', async () => {
      await service.createConversation('First')
      await service.createConversation('Second')
      await service.createConversation('Third')

      const history = await service.getConversationHistory()

      expect(history).toHaveLength(3)
    })

    it('should sort by updatedAt descending (most recent first)', async () => {
      const first = await service.createConversation('First')
      await new Promise(resolve => setTimeout(resolve, 10))
      const second = await service.createConversation('Second')

      const history = await service.getConversationHistory()

      expect(history[0].id).toBe(second.id)
      expect(history[1].id).toBe(first.id)
    })

    it('should include correct metadata in history items', async () => {
      const conversation = await service.createConversation('Test message')

      const history = await service.getConversationHistory()

      expect(history[0]).toMatchObject({
        id: conversation.id,
        title: 'Test message',
        messageCount: 1,
        lastMessage: 'Test message',
      })
      expect(history[0].preview).toBeDefined()
      expect(history[0].createdAt).toBe(conversation.createdAt)
    })
  })

  describe('deleteConversation', () => {
    it('should delete conversation file', async () => {
      const conversation = await service.createConversation('To be deleted')
      const filePath = path.join(conversationsFolder, `${conversation.id}.json`)

      expect(fs.existsSync(filePath)).toBe(true)

      await service.deleteConversation(conversation.id)

      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('should remove from index', async () => {
      const conv1 = await service.createConversation('First')
      const conv2 = await service.createConversation('Second')

      await service.deleteConversation(conv1.id)

      const history = await service.getConversationHistory()
      expect(history).toHaveLength(1)
      expect(history[0].id).toBe(conv2.id)
    })

    it('should handle deleting non-existent conversation gracefully', async () => {
      // Should not throw
      await expect(service.deleteConversation('non_existent')).resolves.not.toThrow()
    })
  })

  describe('addMessageToConversation', () => {
    it('should add message to existing conversation', async () => {
      const conversation = await service.createConversation('Hello')

      const updated = await service.addMessageToConversation(
        conversation.id,
        'Hi there!',
        'assistant'
      )

      expect(updated).not.toBeNull()
      expect(updated!.messages).toHaveLength(2)
      expect(updated!.messages[1].role).toBe('assistant')
      expect(updated!.messages[1].content).toBe('Hi there!')
    })

    it('should return null for non-existent conversation', async () => {
      const result = await service.addMessageToConversation(
        'non_existent',
        'Hello',
        'user'
      )

      expect(result).toBeNull()
    })

    it('should add message with tool calls', async () => {
      const conversation = await service.createConversation('Hello')

      const toolCalls = [{ name: 'web_search', arguments: { query: 'test' } }]
      const updated = await service.addMessageToConversation(
        conversation.id,
        'Searching...',
        'assistant',
        toolCalls
      )

      expect(updated!.messages[1].toolCalls).toEqual(toolCalls)
    })

    it('should add message with tool results', async () => {
      const conversation = await service.createConversation('Hello')

      const toolResults = [{ success: true, content: 'Search results here' }]
      const updated = await service.addMessageToConversation(
        conversation.id,
        'Found results',
        'tool',
        undefined,
        toolResults
      )

      expect(updated!.messages[1].toolResults).toEqual(toolResults)
    })

    it('should skip consecutive duplicate messages (idempotency)', async () => {
      const conversation = await service.createConversation('Hello')

      // Add the same message twice
      await service.addMessageToConversation(conversation.id, 'Reply', 'assistant')
      const result = await service.addMessageToConversation(conversation.id, 'Reply', 'assistant')

      // Should still have only 2 messages (original + one reply)
      expect(result!.messages).toHaveLength(2)
    })

    it('should persist added messages to disk', async () => {
      const conversation = await service.createConversation('Hello')
      await service.addMessageToConversation(conversation.id, 'Reply', 'assistant')

      // Load fresh from disk
      const loaded = await service.loadConversation(conversation.id)
      expect(loaded!.messages).toHaveLength(2)
    })
  })

  describe('deleteAllConversations', () => {
    it('should delete all conversations', async () => {
      await service.createConversation('First')
      await service.createConversation('Second')
      await service.createConversation('Third')

      await service.deleteAllConversations()

      const history = await service.getConversationHistory()
      expect(history).toEqual([])
    })

    it('should remove conversations folder and recreate empty', async () => {
      await service.createConversation('Test')

      await service.deleteAllConversations()

      // Folder should still exist but be empty (except possibly for newly created structure)
      expect(fs.existsSync(conversationsFolder)).toBe(true)

      // No conversation files should exist
      const files = fs.readdirSync(conversationsFolder).filter(f => f.endsWith('.json') && f !== 'index.json')
      expect(files).toHaveLength(0)
    })
  })

  describe('generateConversationIdPublic', () => {
    it('should generate valid conversation ID', () => {
      const id = service.generateConversationIdPublic()

      expect(id).toMatch(/^conv_\d+_[a-z0-9]+$/)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(service.generateConversationIdPublic())
      }

      // All 100 IDs should be unique
      expect(ids.size).toBe(100)
    })
  })

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ConversationService.getInstance()
      const instance2 = ConversationService.getInstance()

      expect(instance1).toBe(instance2)
    })
  })
})

