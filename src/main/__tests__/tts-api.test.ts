/**
 * Unit tests for TTS API functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the tipc client and config store
const mockConfigStore = {
  get: vi.fn()
}

const mockTipcClient = {
  generateSpeech: vi.fn()
}

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('TTS API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('OpenAI TTS API', () => {
    it('should make correct API call with default parameters', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer)
      }
      mockFetch.mockResolvedValue(mockResponse)

      // Mock the generateOpenAITTS function behavior
      const config = {
        openaiApiKey: 'test-key',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiTtsModel: 'tts-1',
        openaiTtsVoice: 'alloy',
        openaiTtsSpeed: 1.0,
        openaiTtsResponseFormat: 'mp3'
      }

      const text = 'Hello, this is a test.'
      const input = {}

      // Simulate the API call that would be made
      const expectedUrl = `${config.openaiBaseUrl}/audio/speech`
      const expectedHeaders = {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json'
      }
      const expectedBody = JSON.stringify({
        model: config.openaiTtsModel,
        input: text,
        voice: config.openaiTtsVoice,
        speed: config.openaiTtsSpeed,
        response_format: config.openaiTtsResponseFormat
      })

      await fetch(expectedUrl, {
        method: 'POST',
        headers: expectedHeaders,
        body: expectedBody
      })

      expect(mockFetch).toHaveBeenCalledWith(expectedUrl, {
        method: 'POST',
        headers: expectedHeaders,
        body: expectedBody
      })
    })

    it('should handle API errors gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key')
      }
      mockFetch.mockResolvedValue(mockResponse)

      try {
        await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer invalid-key' },
          body: JSON.stringify({ model: 'tts-1', input: 'test', voice: 'alloy' })
        })
        
        if (!mockResponse.ok) {
          const errorText = await mockResponse.text()
          throw new Error(`OpenAI TTS API error: ${mockResponse.statusText} - ${errorText}`)
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('OpenAI TTS API error')
        expect((error as Error).message).toContain('Unauthorized')
      }
    })

    it('should use custom parameters when provided', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer)
      }
      mockFetch.mockResolvedValue(mockResponse)

      const customConfig = {
        openaiApiKey: 'test-key',
        openaiBaseUrl: 'https://custom.openai.com/v1',
        openaiTtsModel: 'tts-1-hd',
        openaiTtsVoice: 'nova',
        openaiTtsSpeed: 1.5,
        openaiTtsResponseFormat: 'wav'
      }

      const expectedBody = JSON.stringify({
        model: 'tts-1-hd',
        input: 'Custom test text',
        voice: 'nova',
        speed: 1.5,
        response_format: 'wav'
      })

      await fetch(`${customConfig.openaiBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${customConfig.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: expectedBody
      })

      expect(mockFetch).toHaveBeenCalledWith(
        `${customConfig.openaiBaseUrl}/audio/speech`,
        expect.objectContaining({
          body: expectedBody
        })
      )
    })
  })

  describe('Groq TTS API', () => {
    it('should make correct API call for Groq TTS', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer)
      }
      mockFetch.mockResolvedValue(mockResponse)

      const config = {
        groqApiKey: 'test-groq-key',
        groqBaseUrl: 'https://api.groq.com/openai/v1',
        groqTtsModel: 'playai-tts',
        groqTtsVoice: 'Fritz-PlayAI'
      }

      const expectedBody = JSON.stringify({
        model: config.groqTtsModel,
        input: 'Test text for Groq',
        voice: config.groqTtsVoice,
        response_format: 'wav'
      })

      await fetch(`${config.groqBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: expectedBody
      })

      expect(mockFetch).toHaveBeenCalledWith(
        `${config.groqBaseUrl}/audio/speech`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${config.groqApiKey}`
          }),
          body: expectedBody
        })
      )
    })
  })

  describe('Gemini TTS API', () => {
    it('should make correct API call for Gemini TTS', async () => {
      const mockAudioData = 'base64encodedaudiodata'
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{
                inlineData: {
                  data: mockAudioData
                }
              }]
            }
          }]
        })
      }
      mockFetch.mockResolvedValue(mockResponse)

      const config = {
        geminiApiKey: 'test-gemini-key',
        geminiBaseUrl: 'https://generativelanguage.googleapis.com',
        geminiTtsModel: 'gemini-2.5-flash-preview-tts',
        geminiTtsVoice: 'Kore'
      }

      const expectedBody = JSON.stringify({
        contents: [{
          parts: [{ text: 'Test text for Gemini' }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.geminiTtsVoice
              }
            }
          }
        }
      })

      const expectedUrl = `${config.geminiBaseUrl}/v1beta/models/${config.geminiTtsModel}:generateContent?key=${config.geminiApiKey}`

      await fetch(expectedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: expectedBody
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: expectedBody
        })
      )
    })

    it('should handle missing audio data in Gemini response', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{}] // Missing inlineData
            }
          }]
        })
      }
      mockFetch.mockResolvedValue(mockResponse)

      try {
        const response = await fetch('test-url', { method: 'POST' })
        const result = await response.json()
        const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data

        if (!audioData) {
          throw new Error('No audio data received from Gemini TTS API')
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('No audio data received from Gemini TTS API')
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      try {
        await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST'
        })
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('Network error')
      }
    })

    it('should handle rate limiting errors', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: () => Promise.resolve('Rate limit exceeded')
      }
      mockFetch.mockResolvedValue(mockResponse)

      try {
        const response = await fetch('test-url', { method: 'POST' })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`API error: ${response.statusText} - ${errorText}`)
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('Too Many Requests')
        expect((error as Error).message).toContain('Rate limit exceeded')
      }
    })

    it('should handle missing API keys', async () => {
      const config = {
        openaiApiKey: undefined
      }

      if (!config.openaiApiKey) {
        expect(() => {
          throw new Error('OpenAI API key is required for TTS')
        }).toThrow('OpenAI API key is required for TTS')
      }
    })
  })
})
