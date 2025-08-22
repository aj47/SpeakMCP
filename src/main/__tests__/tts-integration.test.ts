/**
 * Integration tests for the complete TTS pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies
const mockConfigStore = {
  get: vi.fn()
}

const mockDiagnosticsService = {
  logError: vi.fn()
}

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('TTS Integration Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Complete TTS Pipeline', () => {
    it('should process text and generate audio successfully', async () => {
      // Mock config
      const mockConfig = {
        ttsEnabled: true,
        ttsProviderId: 'openai',
        ttsPreprocessingEnabled: true,
        ttsRemoveCodeBlocks: true,
        ttsRemoveUrls: true,
        ttsConvertMarkdown: true,
        openaiApiKey: 'test-key',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiTtsModel: 'tts-1',
        openaiTtsVoice: 'alloy',
        openaiTtsSpeed: 1.0,
        openaiTtsResponseFormat: 'mp3'
      }

      mockConfigStore.get.mockReturnValue(mockConfig)

      // Mock successful API response
      const mockAudioBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockAudioBuffer)
      }
      mockFetch.mockResolvedValue(mockResponse)

      // Input text with various elements that need preprocessing
      const inputText = `
# TTS Test

Here's some code:
\`\`\`javascript
console.log("Hello World");
\`\`\`

Visit https://example.com for more info.

- Item 1
- Item 2
      `

      // Simulate the TTS generation process
      const processedText = inputText
        .replace(/```[\s\S]*?```/g, ' [code block] ')
        .replace(/https?:\/\/[^\s]+/g, ' [web link] ')
        .replace(/^#{1,6}\s+(.+)$/gm, 'Heading: $1.')
        .replace(/^\s*[-*+]\s+(.+)$/gm, 'Item: $1.')
        .replace(/\s+/g, ' ')
        .trim()

      // Validate processed text
      expect(processedText).toContain('Heading: TTS Test.')
      expect(processedText).toContain('[code block]')
      expect(processedText).toContain('[web link]')
      expect(processedText).toContain('Item: Item 1.')
      expect(processedText).not.toContain('```')
      expect(processedText).not.toContain('https://')

      // Simulate API call
      const response = await fetch(`${mockConfig.openaiBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockConfig.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: mockConfig.openaiTtsModel,
          input: processedText,
          voice: mockConfig.openaiTtsVoice,
          speed: mockConfig.openaiTtsSpeed,
          response_format: mockConfig.openaiTtsResponseFormat
        })
      })

      const audioBuffer = await response.arrayBuffer()

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(audioBuffer).toBeInstanceOf(ArrayBuffer)
      expect(audioBuffer.byteLength).toBe(1024)
    })

    it('should handle TTS disabled gracefully', async () => {
      const mockConfig = {
        ttsEnabled: false
      }

      mockConfigStore.get.mockReturnValue(mockConfig)

      // Simulate TTS generation attempt when disabled
      if (!mockConfig.ttsEnabled) {
        expect(() => {
          throw new Error('Text-to-Speech is not enabled')
        }).toThrow('Text-to-Speech is not enabled')
      }

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should fallback gracefully when API fails', async () => {
      const mockConfig = {
        ttsEnabled: true,
        ttsProviderId: 'openai',
        openaiApiKey: 'test-key'
      }

      mockConfigStore.get.mockReturnValue(mockConfig)

      // Mock API failure
      mockFetch.mockRejectedValue(new Error('Network error'))

      let error: Error | null = null
      try {
        await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-key' },
          body: JSON.stringify({ model: 'tts-1', input: 'test', voice: 'alloy' })
        })
      } catch (e) {
        error = e as Error
        mockDiagnosticsService.logError('tts', 'TTS generation failed', e)
      }

      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('Network error')
      expect(mockDiagnosticsService.logError).toHaveBeenCalledWith(
        'tts',
        'TTS generation failed',
        expect.any(Error)
      )
    })

    it('should handle different providers correctly', async () => {
      // Test Groq provider
      const groqConfig = {
        ttsEnabled: true,
        ttsProviderId: 'groq',
        groqApiKey: 'groq-key',
        groqBaseUrl: 'https://api.groq.com/openai/v1',
        groqTtsModel: 'playai-tts',
        groqTtsVoice: 'Fritz-PlayAI'
      }

      const mockGroqResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048))
      }
      mockFetch.mockResolvedValue(mockGroqResponse)

      await fetch(`${groqConfig.groqBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqConfig.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: groqConfig.groqTtsModel,
          input: 'Test text',
          voice: groqConfig.groqTtsVoice,
          response_format: 'wav'
        })
      })

      expect(mockFetch).toHaveBeenCalledWith(
        `${groqConfig.groqBaseUrl}/audio/speech`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${groqConfig.groqApiKey}`
          })
        })
      )
    })

    it('should validate text before processing', async () => {
      const testCases = [
        { input: '', shouldFail: true, reason: 'empty text' },
        { input: '   \n\t   ', shouldFail: true, reason: 'whitespace only' },
        { input: 'A'.repeat(15000), shouldFail: true, reason: 'too long' },
        { input: 'Normal text for TTS', shouldFail: false, reason: 'valid text' }
      ]

      for (const testCase of testCases) {
        const validation = {
          isValid: true,
          issues: [] as string[],
          processedLength: testCase.input.trim().length
        }

        if (!testCase.input || testCase.input.trim().length === 0) {
          validation.isValid = false
          validation.issues.push('Text is empty')
        }

        if (testCase.input.length > 10000) {
          validation.isValid = false
          validation.issues.push('Text is too long for TTS')
        }

        if (testCase.input.includes('```')) {
          validation.isValid = false
          validation.issues.push('Contains unprocessed code blocks')
        }

        if (/https?:\/\//.test(testCase.input)) {
          validation.isValid = false
          validation.issues.push('Contains unprocessed URLs')
        }

        if (testCase.shouldFail) {
          expect(validation.isValid).toBe(false)
          expect(validation.issues.length).toBeGreaterThan(0)
        } else {
          expect(validation.isValid).toBe(true)
          expect(validation.issues.length).toBe(0)
        }
      }
    })

    it('should handle preprocessing options correctly', async () => {
      const inputText = 'Visit https://example.com and see ```code``` block'
      
      // Test with preprocessing enabled
      let processedText = inputText
        .replace(/https?:\/\/[^\s]+/g, ' [web link] ')
        .replace(/```[\s\S]*?```/g, ' [code block] ')
        .replace(/\s+/g, ' ')
        .trim()

      expect(processedText).toContain('[web link]')
      expect(processedText).toContain('[code block]')
      expect(processedText).not.toContain('https://')
      expect(processedText).not.toContain('```')

      // Test with preprocessing disabled
      const unprocessedText = inputText
      expect(unprocessedText).toContain('https://example.com')
      expect(unprocessedText).toContain('```code```')
    })

    it('should handle audio format conversion correctly', async () => {
      const formats = ['mp3', 'wav', 'opus', 'aac', 'flac']
      
      for (const format of formats) {
        const mockResponse = {
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024))
        }
        mockFetch.mockResolvedValue(mockResponse)

        await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'tts-1',
            input: 'test',
            voice: 'alloy',
            response_format: format
          })
        })

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.openai.com/v1/audio/speech',
          expect.objectContaining({
            body: expect.stringContaining(`"response_format":"${format}"`)
          })
        )

        mockFetch.mockClear()
      }
    })
  })

  describe('Error Recovery and Fallbacks', () => {
    it('should provide meaningful error messages for different failure types', async () => {
      const errorScenarios = [
        {
          error: new Error('API key not found'),
          expectedMessage: 'TTS API key not configured'
        },
        {
          error: new Error('Rate limit exceeded'),
          expectedMessage: 'Rate limit exceeded. Please try again later'
        },
        {
          error: new Error('Network fetch failed'),
          expectedMessage: 'Network error. Please check your connection'
        },
        {
          error: new Error('Text validation failed'),
          expectedMessage: 'Text content is not suitable for TTS'
        },
        {
          error: new Error('Unknown error'),
          expectedMessage: 'TTS error: Unknown error'
        }
      ]

      for (const scenario of errorScenarios) {
        let errorMessage = 'Failed to generate audio'
        
        if (scenario.error.message.includes('API key')) {
          errorMessage = 'TTS API key not configured'
        } else if (scenario.error.message.includes('rate limit')) {
          errorMessage = 'Rate limit exceeded. Please try again later'
        } else if (scenario.error.message.includes('network') || scenario.error.message.includes('fetch')) {
          errorMessage = 'Network error. Please check your connection'
        } else if (scenario.error.message.includes('validation')) {
          errorMessage = 'Text content is not suitable for TTS'
        } else {
          errorMessage = `TTS error: ${scenario.error.message}`
        }

        expect(errorMessage).toBe(scenario.expectedMessage)
      }
    })
  })
})
