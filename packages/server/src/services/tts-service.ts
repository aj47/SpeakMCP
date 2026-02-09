import fs from 'fs'
import os from 'os'
import path from 'path'
import { configStore, ensureDir } from '../config'

type SupportedProvider = 'openai' | 'groq' | 'gemini'

export interface GenerateTTSInput {
  text: string
  providerId?: SupportedProvider
  voice?: string
  model?: string
  speed?: number
}

export interface GeneratedTTSMetadata {
  provider: SupportedProvider
  processedText: string
  outputPath: string
  fileName: string
  mimeType: string
  sizeBytes: number
  playbackCommand: string
}

function cleanupWhitespace(input: string): string {
  return input.replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function preprocessText(text: string, config: Record<string, unknown>): string {
  if (config.ttsPreprocessingEnabled === false) {
    return cleanupWhitespace(text)
  }

  let out = text

  if (config.ttsRemoveCodeBlocks !== false) {
    out = out
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
  }

  if (config.ttsRemoveUrls !== false) {
    out = out.replace(/https?:\/\/\S+/g, ' ')
  }

  if (config.ttsConvertMarkdown !== false) {
    out = out
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
  }

  return cleanupWhitespace(out)
}

function ensureValidInput(text: string): void {
  if (!text || !text.trim()) {
    throw new Error('Text is required for TTS generation')
  }

  if (text.length > 6000) {
    throw new Error('Text too long for TTS generation (max 6000 characters)')
  }
}

function getPlaybackCommand(filePath: string): string {
  if (process.platform === 'darwin') {
    return `afplay ${JSON.stringify(filePath)}`
  }
  if (process.platform === 'win32') {
    return `powershell -Command \"(New-Object Media.SoundPlayer ${JSON.stringify(filePath)}).PlaySync()\"`
  }
  return `paplay ${JSON.stringify(filePath)} || aplay ${JSON.stringify(filePath)}`
}

function getOutputDir(): string {
  const dir = path.join(os.homedir(), '.speakmcp', 'tts')
  ensureDir(dir)
  return dir
}

function writeAudioFile(buffer: ArrayBuffer, extension: string): {
  outputPath: string
  fileName: string
  sizeBytes: number
} {
  const outputDir = getOutputDir()
  const stamp = new Date().toISOString().replace(/[.:]/g, '-')
  const fileName = `tts-${stamp}.${extension}`
  const outputPath = path.join(outputDir, fileName)

  const nodeBuffer = Buffer.from(buffer)
  fs.writeFileSync(outputPath, nodeBuffer)

  return {
    outputPath,
    fileName,
    sizeBytes: nodeBuffer.byteLength,
  }
}

async function generateOpenAITTS(
  text: string,
  input: GenerateTTSInput,
  config: Record<string, unknown>,
): Promise<{ audio: ArrayBuffer; extension: string; mimeType: string }> {
  const apiKey = config.openaiApiKey as string | undefined
  if (!apiKey) {
    throw new Error('OpenAI API key is required for TTS')
  }

  const model = input.model || (config.openaiTtsModel as string) || 'tts-1'
  const voice = input.voice || (config.openaiTtsVoice as string) || 'alloy'
  const speed = input.speed || (config.openaiTtsSpeed as number) || 1
  const responseFormat = (config.openaiTtsResponseFormat as string) || 'mp3'
  const baseUrl = (config.openaiBaseUrl as string) || 'https://api.openai.com/v1'

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      speed,
      response_format: responseFormat,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI TTS API error: ${response.statusText} - ${errorText}`)
  }

  return {
    audio: await response.arrayBuffer(),
    extension: responseFormat,
    mimeType: responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
  }
}

async function generateGroqTTS(
  text: string,
  input: GenerateTTSInput,
  config: Record<string, unknown>,
): Promise<{ audio: ArrayBuffer; extension: string; mimeType: string }> {
  const apiKey = config.groqApiKey as string | undefined
  if (!apiKey) {
    throw new Error('Groq API key is required for TTS')
  }

  const model = input.model || (config.groqTtsModel as string) || 'canopylabs/orpheus-v1-english'
  const defaultVoice = model === 'canopylabs/orpheus-arabic-saudi' ? 'fahad' : 'troy'
  const voice = input.voice || (config.groqTtsVoice as string) || defaultVoice
  const baseUrl = (config.groqBaseUrl as string) || 'https://api.groq.com/openai/v1'

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: 'wav',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (errorText.includes('requires terms acceptance')) {
      throw new Error('Groq TTS model requires terms acceptance in Groq Console')
    }
    throw new Error(`Groq TTS API error: ${response.statusText} - ${errorText}`)
  }

  return {
    audio: await response.arrayBuffer(),
    extension: 'wav',
    mimeType: 'audio/wav',
  }
}

async function generateGeminiTTS(
  text: string,
  input: GenerateTTSInput,
  config: Record<string, unknown>,
): Promise<{ audio: ArrayBuffer; extension: string; mimeType: string }> {
  const apiKey = config.geminiApiKey as string | undefined
  if (!apiKey) {
    throw new Error('Gemini API key is required for TTS')
  }

  const model = input.model || (config.geminiTtsModel as string) || 'gemini-2.5-flash-preview-tts'
  const voice = input.voice || (config.geminiTtsVoice as string) || 'Kore'
  const baseUrl = (config.geminiBaseUrl as string) || 'https://generativelanguage.googleapis.com'

  const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini TTS API error: ${response.statusText} - ${errorText}`)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string
            mimeType?: string
          }
        }>
      }
    }>
  }

  const inlineData = payload.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!inlineData?.data) {
    throw new Error('No audio data received from Gemini TTS API')
  }

  const mimeType = inlineData.mimeType || 'audio/wav'
  const extension = mimeType.includes('mpeg') ? 'mp3' : 'wav'
  const buffer = Buffer.from(inlineData.data, 'base64')

  return {
    audio: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    extension,
    mimeType,
  }
}

export async function generateSpeechToFile(input: GenerateTTSInput): Promise<GeneratedTTSMetadata> {
  ensureValidInput(input.text)

  const config = configStore.get() as Record<string, unknown>
  if (config.ttsEnabled === false) {
    throw new Error('Text-to-Speech is disabled in settings')
  }

  const provider = (input.providerId || (config.ttsProviderId as SupportedProvider) || 'openai') as SupportedProvider
  if (provider !== 'openai' && provider !== 'groq' && provider !== 'gemini') {
    throw new Error(`Unsupported TTS provider: ${provider}`)
  }

  const processedText = preprocessText(input.text, config)
  ensureValidInput(processedText)

  const generated =
    provider === 'openai'
      ? await generateOpenAITTS(processedText, input, config)
      : provider === 'groq'
        ? await generateGroqTTS(processedText, input, config)
        : await generateGeminiTTS(processedText, input, config)

  const written = writeAudioFile(generated.audio, generated.extension)

  return {
    provider,
    processedText,
    outputPath: written.outputPath,
    fileName: written.fileName,
    sizeBytes: written.sizeBytes,
    mimeType: generated.mimeType,
    playbackCommand: getPlaybackCommand(written.outputPath),
  }
}
