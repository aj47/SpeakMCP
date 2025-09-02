/**
 * TTS debugging service for web debugging mode
 * Provides TTS-specific debugging capabilities and integrates with Playwright MCP tools
 */

import { logger } from '../utils/logger'
import { EventEmitter } from 'events'

export interface TTSDebugConfig {
  enableTTSLogging: boolean
  enablePreprocessingLogging: boolean
  enableValidationLogging: boolean
  enableProviderComparison: boolean
  mockTTSResponses: boolean
  mockDelay: number
}

export interface TTSDebugRequest {
  id: string
  text: string
  provider: string
  voice?: string
  model?: string
  speed?: number
  timestamp: number
  sessionId?: string
}

export interface TTSDebugResponse {
  id: string
  requestId: string
  success: boolean
  audioBuffer?: ArrayBuffer
  audioSize?: number
  duration: number
  provider: string
  processedText?: string
  error?: string
  timestamp: number
}

export interface TTSPreprocessingResult {
  originalText: string
  processedText: string
  originalLength: number
  processedLength: number
  options: any
  issues: string[]
  isValid: boolean
}

export class TTSDebugService extends EventEmitter {
  private config: TTSDebugConfig
  private requests: Map<string, TTSDebugRequest> = new Map()
  private responses: Map<string, TTSDebugResponse> = new Map()
  private preprocessingResults: Map<string, TTSPreprocessingResult> = new Map()

  constructor(config: Partial<TTSDebugConfig> = {}) {
    super()
    
    this.config = {
      enableTTSLogging: true,
      enablePreprocessingLogging: true,
      enableValidationLogging: true,
      enableProviderComparison: false,
      mockTTSResponses: false,
      mockDelay: 1000,
      ...config
    }

    logger.info('tts', 'TTS Debug Service initialized', {
      data: { config: this.config }
    })
  }

  public async debugTTSGeneration(
    text: string,
    provider: string = 'openai',
    options: {
      voice?: string
      model?: string
      speed?: number
      sessionId?: string
    } = {}
  ): Promise<TTSDebugResponse> {
    const requestId = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const startTime = Date.now()

    // Create debug request
    const request: TTSDebugRequest = {
      id: requestId,
      text,
      provider,
      voice: options.voice,
      model: options.model,
      speed: options.speed,
      timestamp: startTime,
      sessionId: options.sessionId
    }

    this.requests.set(requestId, request)

    if (this.config.enableTTSLogging) {
      logger.info('tts', `Starting TTS debug generation: ${provider}`, {
        sessionId: options.sessionId,
        data: {
          requestId,
          provider,
          textLength: text.length,
          voice: options.voice,
          model: options.model
        }
      })
    }

    try {
      let audioBuffer: ArrayBuffer
      let processedText = text

      // Mock TTS response if enabled
      if (this.config.mockTTSResponses) {
        audioBuffer = await this.generateMockTTSResponse(text, provider)
        if (this.config.mockDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.config.mockDelay))
        }
      } else {
        // In web debugging mode, we'll simulate calling the actual TTS service
        // This would integrate with the main app's TTS functionality
        audioBuffer = await this.callActualTTSService(text, provider, options)
      }

      const duration = Date.now() - startTime
      const response: TTSDebugResponse = {
        id: `resp_${requestId}`,
        requestId,
        success: true,
        audioBuffer,
        audioSize: audioBuffer.byteLength,
        duration,
        provider,
        processedText,
        timestamp: Date.now()
      }

      this.responses.set(requestId, response)

      if (this.config.enableTTSLogging) {
        logger.info('tts', `TTS debug generation completed: ${provider}`, {
          sessionId: options.sessionId,
          data: {
            requestId,
            provider,
            audioSize: audioBuffer.byteLength,
            audioSizeKB: Math.round(audioBuffer.byteLength / 1024),
            duration
          }
        })
      }

      this.emit('tts-response', response)
      return response

    } catch (error) {
      const duration = Date.now() - startTime
      const response: TTSDebugResponse = {
        id: `resp_${requestId}`,
        requestId,
        success: false,
        duration,
        provider,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      }

      this.responses.set(requestId, response)

      if (this.config.enableTTSLogging) {
        logger.error('tts', `TTS debug generation failed: ${provider}`, {
          sessionId: options.sessionId,
          error: error instanceof Error ? error : new Error(String(error)),
          data: { requestId, provider, duration }
        })
      }

      this.emit('tts-error', response)
      throw error
    }
  }

  public debugTTSPreprocessing(
    text: string,
    options: any = {},
    sessionId?: string
  ): TTSPreprocessingResult {
    const preprocessingId = `prep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    if (this.config.enablePreprocessingLogging) {
      logger.debug('tts-preprocessing', 'Starting TTS text preprocessing', {
        sessionId,
        data: { preprocessingId, originalLength: text.length, options }
      })
    }

    // Simulate preprocessing (in real implementation, this would call the actual preprocessing)
    const processedText = this.simulateTextPreprocessing(text, options)
    const issues: string[] = []
    
    // Validate processed text
    let isValid = true
    if (processedText.length === 0) {
      issues.push('Processed text is empty')
      isValid = false
    }
    if (processedText.length > 10000) {
      issues.push('Processed text is too long')
      isValid = false
    }

    const result: TTSPreprocessingResult = {
      originalText: text,
      processedText,
      originalLength: text.length,
      processedLength: processedText.length,
      options,
      issues,
      isValid
    }

    this.preprocessingResults.set(preprocessingId, result)

    if (this.config.enablePreprocessingLogging) {
      logger.debug('tts-preprocessing', 'TTS preprocessing completed', {
        sessionId,
        data: {
          preprocessingId,
          originalLength: text.length,
          processedLength: processedText.length,
          reductionPercent: Math.round((1 - processedText.length / text.length) * 100)
        }
      })
    }

    if (this.config.enableValidationLogging) {
      logger.logTTSValidation(isValid, issues, sessionId)
    }

    this.emit('tts-preprocessing', result)
    return result
  }

  private async generateMockTTSResponse(text: string, provider: string): Promise<ArrayBuffer> {
    // Generate a mock audio buffer based on text length
    const estimatedSize = Math.max(1024, text.length * 50) // Rough estimate
    const buffer = new ArrayBuffer(estimatedSize)
    const view = new Uint8Array(buffer)
    
    // Fill with some mock audio data pattern
    for (let i = 0; i < view.length; i++) {
      view[i] = Math.floor(Math.sin(i * 0.1) * 127 + 128)
    }

    logger.debug('tts', `Generated mock TTS response for ${provider}`, {
      data: { textLength: text.length, audioSize: buffer.byteLength }
    })

    return buffer
  }

  private async callActualTTSService(
    text: string,
    provider: string,
    options: any
  ): Promise<ArrayBuffer> {
    // In a real implementation, this would call the main app's TTS service
    // For now, we'll generate a mock response
    return this.generateMockTTSResponse(text, provider)
  }

  private simulateTextPreprocessing(text: string, options: any): string {
    let processed = text

    // Simulate basic preprocessing steps
    if (options.removeCodeBlocks !== false) {
      processed = processed.replace(/```[\s\S]*?```/g, ' [code block] ')
      processed = processed.replace(/`([^`]+)`/g, ' $1 ')
    }

    if (options.removeUrls !== false) {
      processed = processed.replace(/https?:\/\/[^\s]+/g, ' [URL] ')
    }

    if (options.convertMarkdown !== false) {
      processed = processed.replace(/^#{1,6}\s+(.+)$/gm, 'Heading: $1.')
      processed = processed.replace(/\*\*([^*]+)\*\*/g, '$1')
      processed = processed.replace(/\*([^*]+)\*/g, '$1')
    }

    // Clean up whitespace
    processed = processed.replace(/\s+/g, ' ').trim()

    return processed
  }

  public getRequests(): TTSDebugRequest[] {
    return Array.from(this.requests.values())
  }

  public getResponses(): TTSDebugResponse[] {
    return Array.from(this.responses.values())
  }

  public getPreprocessingResults(): TTSPreprocessingResult[] {
    return Array.from(this.preprocessingResults.values())
  }

  public clearHistory(): void {
    this.requests.clear()
    this.responses.clear()
    this.preprocessingResults.clear()
    logger.info('tts', 'TTS debug history cleared')
  }

  public updateConfig(updates: Partial<TTSDebugConfig>): void {
    this.config = { ...this.config, ...updates }
    logger.info('tts', 'TTS debug config updated', { data: updates })
  }
}

// Export singleton instance
export const ttsDebugService = new TTSDebugService()
