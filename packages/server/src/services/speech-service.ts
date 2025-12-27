import OpenAI from 'openai'
import { config } from '../config.js'
import { configService } from './config-service.js'

export interface TranscribeOptions {
  language?: string
  prompt?: string
  providerId?: 'openai' | 'groq'
}

export interface SpeakOptions {
  voice?: string
  model?: string
  providerId?: 'openai' | 'groq' | 'gemini'
  speed?: number
}

export const speechService = {
  /**
   * Transcribe audio to text (STT)
   */
  async transcribe(
    audio: Buffer,
    filename: string,
    options: TranscribeOptions = {}
  ): Promise<string> {
    const appConfig = configService.get()
    const providerId = options.providerId ?? appConfig.sttProviderId ?? 'openai'
    
    const client = getClientForProvider(providerId)
    
    // Create a File-like object for the API
    const file = new File([audio], filename, { 
      type: getAudioMimeType(filename) 
    })

    const transcription = await client.audio.transcriptions.create({
      file,
      model: providerId === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1',
      language: options.language ?? appConfig.sttLanguage,
      prompt: options.prompt ?? (providerId === 'groq' ? appConfig.sttGroqPrompt : undefined),
    })

    return transcription.text
  },

  /**
   * Generate speech from text (TTS)
   */
  async speak(
    text: string,
    options: SpeakOptions = {}
  ): Promise<Buffer> {
    const appConfig = configService.get()
    const providerId = options.providerId ?? appConfig.ttsProviderId ?? 'openai'
    
    const client = getClientForProvider(providerId)

    let model: string
    let voice: string

    switch (providerId) {
      case 'groq':
        model = options.model ?? appConfig.ttsModel ?? 'playai-tts'
        voice = options.voice ?? appConfig.ttsVoice ?? 'Arista-PlayAI'
        break
      case 'gemini':
        model = options.model ?? appConfig.ttsModel ?? 'gemini-2.5-flash-preview-tts'
        voice = options.voice ?? appConfig.ttsVoice ?? 'Kore'
        break
      case 'openai':
      default:
        model = options.model ?? appConfig.ttsModel ?? 'tts-1'
        voice = options.voice ?? appConfig.ttsVoice ?? 'alloy'
        break
    }

    const response = await client.audio.speech.create({
      model,
      voice: voice as any,
      input: text,
      speed: options.speed,
    })

    // Get the audio data as ArrayBuffer then convert to Buffer
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  },

  /**
   * Preprocess text for TTS (clean up for better speech)
   */
  async preprocessForTTS(text: string): Promise<string> {
    const appConfig = configService.get()
    
    if (!appConfig.ttsPreprocessingEnabled) {
      return text
    }

    if (appConfig.ttsPreprocessingMode === 'regex') {
      return regexPreprocess(text)
    }

    // LLM preprocessing
    const client = getClientForProvider(appConfig.mcpToolsProviderId ?? 'openai')
    
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a text preprocessor for text-to-speech. Clean up the following text to make it more natural when spoken aloud. 
- Remove markdown formatting
- Expand abbreviations
- Convert code/technical terms to spoken equivalents
- Remove URLs or describe them briefly
- Keep the meaning intact
Output only the processed text, nothing else.`
        },
        { role: 'user', content: text }
      ],
      max_tokens: 1000,
    })

    return response.choices[0]?.message?.content ?? text
  },
}

function getClientForProvider(providerId: string): OpenAI {
  const appConfig = configService.get()
  
  switch (providerId) {
    case 'groq':
      return new OpenAI({
        apiKey: appConfig.groqApiKey ?? config.groq.apiKey,
        baseURL: appConfig.groqBaseUrl ?? config.groq.baseUrl,
      })
    case 'gemini':
      return new OpenAI({
        apiKey: appConfig.geminiApiKey ?? config.gemini.apiKey,
        baseURL: appConfig.geminiBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      })
    case 'openai':
    default:
      return new OpenAI({
        apiKey: appConfig.openaiApiKey ?? config.openai.apiKey,
        baseURL: appConfig.openaiBaseUrl ?? config.openai.baseUrl,
      })
  }
}

function getAudioMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'webm':
      return 'audio/webm'
    case 'ogg':
      return 'audio/ogg'
    case 'm4a':
      return 'audio/m4a'
    case 'flac':
      return 'audio/flac'
    default:
      return 'audio/webm'
  }
}

function regexPreprocess(text: string): string {
  let result = text

  // Remove markdown formatting
  result = result.replace(/\*\*(.*?)\*\*/g, '$1') // bold
  result = result.replace(/\*(.*?)\*/g, '$1') // italic
  result = result.replace(/`(.*?)`/g, '$1') // inline code
  result = result.replace(/```[\s\S]*?```/g, '') // code blocks
  result = result.replace(/#+\s/g, '') // headers
  result = result.replace(/\[(.*?)\]\(.*?\)/g, '$1') // links

  // Remove URLs
  result = result.replace(/https?:\/\/\S+/g, '')

  // Clean up whitespace
  result = result.replace(/\n\n+/g, '\n')
  result = result.trim()

  return result
}

