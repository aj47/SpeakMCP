// Mock Electron APIs for web debugging mode

import type { Config, Conversation, ConversationHistoryItem } from '../../shared/types'

// Mock configuration for web debugging
const mockConfig: Config = {
  themePreference: 'system',
  mcpToolsEnabled: true,
  mcpAgentModeEnabled: true,
  mcpMaxIterations: 10,
  conversationsEnabled: true,
  autoSaveConversations: false,
  sttProviderId: 'openai',
  llmProviderId: 'openai',
  ttsProviderId: 'openai',
  openaiApiKey: '',
  groqApiKey: '',
  anthropicApiKey: '',
  openaiModel: 'gpt-4',
  groqModel: 'llama-3.1-70b-versatile',
  anthropicModel: 'claude-3-5-sonnet-20241022',
  openaiTtsModel: 'tts-1',
  openaiTtsVoice: 'alloy',
  groqTtsModel: 'playai-tts',
  groqTtsVoice: 'Fritz-PlayAI',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  elevenLabsModel: 'eleven_multilingual_v2',
  openaiBaseUrl: 'https://api.openai.com/v1',
  groqBaseUrl: 'https://api.groq.com/openai/v1',
  anthropicBaseUrl: 'https://api.anthropic.com',
  elevenLabsBaseUrl: 'https://api.elevenlabs.io',
  recordingHistoryEnabled: true,
  maxRecordingHistoryItems: 100,
  mcpConfigPath: '',
  mcpConfig: { mcpServers: {} },
  windowBounds: { width: 800, height: 600, x: 100, y: 100 },
  panelBounds: { width: 400, height: 300, x: 200, y: 200 },
  shortcuts: {
    toggleRecording: 'CommandOrControl+Shift+Space',
    togglePanel: 'CommandOrControl+Shift+P',
    toggleMainWindow: 'CommandOrControl+Shift+M'
  }
}

// Mock conversations storage
let mockConversations: Conversation[] = []
let mockConversationHistory: ConversationHistoryItem[] = []

// Mock IPC renderer
const mockIpcRenderer = {
  invoke: async (channel: string, ...args: any[]): Promise<any> => {
    console.log(`[MOCK IPC] invoke: ${channel}`, args)
    
    // Return mock data based on the channel
    switch (channel) {
      case 'getConfig':
        return mockConfig
      case 'getMicrophoneStatus':
        return 'granted'
      case 'getConversationHistory':
        return mockConversationHistory
      case 'loadConversation':
        const { conversationId } = args[0] || {}
        return mockConversations.find(c => c.id === conversationId) || null
      case 'saveConversation':
        const { conversation } = args[0] || {}
        if (conversation) {
          const existingIndex = mockConversations.findIndex(c => c.id === conversation.id)
          if (existingIndex >= 0) {
            mockConversations[existingIndex] = conversation
          } else {
            mockConversations.push(conversation)
          }
          // Update history
          const historyItem: ConversationHistoryItem = {
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt || Date.now(),
            messageCount: conversation.messages?.length || 0
          }
          const historyIndex = mockConversationHistory.findIndex(h => h.id === conversation.id)
          if (historyIndex >= 0) {
            mockConversationHistory[historyIndex] = historyItem
          } else {
            mockConversationHistory.push(historyItem)
          }
        }
        return true
      case 'createConversation':
        const { firstMessage, role = 'user' } = args[0] || {}
        const newConversation: Conversation = {
          id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: firstMessage?.substring(0, 50) || 'New Conversation',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: firstMessage ? [{
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            role,
            content: firstMessage,
            timestamp: Date.now()
          }] : []
        }
        mockConversations.push(newConversation)
        mockConversationHistory.push({
          id: newConversation.id,
          title: newConversation.title,
          createdAt: newConversation.createdAt,
          updatedAt: newConversation.updatedAt,
          messageCount: newConversation.messages.length
        })
        return newConversation
      case 'addMessageToConversation':
        const { conversationId: msgConvId, content, role: msgRole, toolCalls, toolResults } = args[0] || {}
        const targetConversation = mockConversations.find(c => c.id === msgConvId)
        if (targetConversation) {
          const newMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            role: msgRole,
            content,
            timestamp: Date.now(),
            toolCalls,
            toolResults
          }
          targetConversation.messages.push(newMessage)
          targetConversation.updatedAt = Date.now()
          
          // Update history
          const historyItem = mockConversationHistory.find(h => h.id === msgConvId)
          if (historyItem) {
            historyItem.updatedAt = Date.now()
            historyItem.messageCount = targetConversation.messages.length
          }
          
          return newMessage
        }
        return null
      case 'isAccessibilityGranted':
        return true
      case 'getMcpServerStatus':
        return { status: 'disconnected', servers: {} }
      case 'getMcpInitializationStatus':
        return { initialized: false, error: null }
      case 'fetchAvailableModels':
        const { providerId } = args[0] || {}
        const mockModels = {
          openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
          groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant'],
          anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']
        }
        return mockModels[providerId as keyof typeof mockModels] || []
      default:
        console.warn(`[MOCK IPC] Unhandled invoke: ${channel}`)
        return null
    }
  },
  
  on: (channel: string, listener: (...args: any[]) => void) => {
    console.log(`[MOCK IPC] on: ${channel}`)
    // Mock event listener registration
    return () => {
      console.log(`[MOCK IPC] removeListener: ${channel}`)
    }
  },
  
  send: (channel: string, ...args: any[]) => {
    console.log(`[MOCK IPC] send: ${channel}`, args)
    // Mock send (fire-and-forget)
  },
  
  removeAllListeners: (channel: string) => {
    console.log(`[MOCK IPC] removeAllListeners: ${channel}`)
  }
}

// Mock Electron window object
const mockElectron = {
  ipcRenderer: mockIpcRenderer
}

// Mock TIPC client
export const createMockTipcClient = () => {
  return {
    getConfig: () => mockIpcRenderer.invoke('getConfig'),
    getMicrophoneStatus: () => mockIpcRenderer.invoke('getMicrophoneStatus'),
    getConversationHistory: () => mockIpcRenderer.invoke('getConversationHistory'),
    loadConversation: (args: { conversationId: string }) => mockIpcRenderer.invoke('loadConversation', args),
    saveConversation: (args: { conversation: Conversation }) => mockIpcRenderer.invoke('saveConversation', args),
    createConversation: (args: { firstMessage: string; role?: 'user' | 'assistant' }) => 
      mockIpcRenderer.invoke('createConversation', args),
    addMessageToConversation: (args: {
      conversationId: string
      content: string
      role: 'user' | 'assistant' | 'tool'
      toolCalls?: Array<{ name: string; arguments: any }>
      toolResults?: Array<{ success: boolean; content: string; error?: string }>
    }) => mockIpcRenderer.invoke('addMessageToConversation', args),
    isAccessibilityGranted: () => mockIpcRenderer.invoke('isAccessibilityGranted'),
    getMcpServerStatus: () => mockIpcRenderer.invoke('getMcpServerStatus'),
    getMcpInitializationStatus: () => mockIpcRenderer.invoke('getMcpInitializationStatus'),
    fetchAvailableModels: (args: { providerId: string }) => mockIpcRenderer.invoke('fetchAvailableModels', args),
    // Add more TIPC methods as needed
    requestMicrophonePermission: () => Promise.resolve('granted'),
    requestAccessibilityPermission: () => Promise.resolve(true),
    openExternalLink: (args: { url: string }) => {
      window.open(args.url, '_blank')
      return Promise.resolve()
    },
    showInFinder: () => Promise.resolve(),
    copyToClipboard: (args: { text: string }) => {
      navigator.clipboard.writeText(args.text)
      return Promise.resolve()
    },
    saveMcpConfigFile: () => Promise.resolve(),
    // Mock other methods that might be called
    processTranscriptWithTools: () => Promise.resolve({ processedTranscript: 'Mock processed transcript' }),
    processTranscriptWithAgentMode: () => Promise.resolve({ processedTranscript: 'Mock agent mode result' }),
    startRecording: () => Promise.resolve(),
    stopRecording: () => Promise.resolve(),
    playTTS: () => Promise.resolve(),
    stopTTS: () => Promise.resolve(),
  }
}

// Mock renderer handlers
export const createMockRendererHandlers = () => {
  return {
    on: mockIpcRenderer.on,
    send: mockIpcRenderer.send
  }
}

// Initialize mock Electron environment
export const initializeMockElectron = () => {
  // Only initialize if we're in a browser environment (not Electron)
  if (typeof window !== 'undefined' && !(window as any).electron) {
    (window as any).electron = mockElectron
    console.log('[MOCK] Initialized mock Electron environment for web debugging')
  }
}

// Export mock data for external access
export const getMockConversations = () => mockConversations
export const getMockConversationHistory = () => mockConversationHistory
export const getMockConfig = () => mockConfig
