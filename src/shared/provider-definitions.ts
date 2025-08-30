/**
 * Provider Definitions
 * 
 * This file contains the actual provider configurations and capabilities
 * for all supported AI providers.
 */

import { ProviderDefinition, VoiceOption, TTSModelOption, ModelInfo } from "./provider-system"

// OpenAI TTS Voices
const OPENAI_TTS_VOICES: VoiceOption[] = [
  { id: "alloy", name: "Alloy", gender: "neutral" },
  { id: "echo", name: "Echo", gender: "male" },
  { id: "fable", name: "Fable", gender: "neutral" },
  { id: "onyx", name: "Onyx", gender: "male" },
  { id: "nova", name: "Nova", gender: "female" },
  { id: "shimmer", name: "Shimmer", gender: "female" },
]

const OPENAI_TTS_MODELS: TTSModelOption[] = [
  { id: "tts-1", name: "TTS-1 (Standard)", quality: "standard" },
  { id: "tts-1-hd", name: "TTS-1-HD (High Quality)", quality: "hd" },
]

// Groq TTS Voices
const GROQ_TTS_VOICES: VoiceOption[] = [
  { id: "Arista-PlayAI", name: "Arista", language: "en", gender: "female" },
  { id: "Atlas-PlayAI", name: "Atlas", language: "en", gender: "male" },
  { id: "Basil-PlayAI", name: "Basil", language: "en", gender: "male" },
  { id: "Briggs-PlayAI", name: "Briggs", language: "en", gender: "male" },
  { id: "Calum-PlayAI", name: "Calum", language: "en", gender: "male" },
  { id: "Celeste-PlayAI", name: "Celeste", language: "en", gender: "female" },
  { id: "Cheyenne-PlayAI", name: "Cheyenne", language: "en", gender: "female" },
  { id: "Chip-PlayAI", name: "Chip", language: "en", gender: "male" },
  { id: "Cillian-PlayAI", name: "Cillian", language: "en", gender: "male" },
  { id: "Deedee-PlayAI", name: "Deedee", language: "en", gender: "female" },
  { id: "Fritz-PlayAI", name: "Fritz", language: "en", gender: "male" },
  { id: "Gail-PlayAI", name: "Gail", language: "en", gender: "female" },
  { id: "Indigo-PlayAI", name: "Indigo", language: "en", gender: "neutral" },
  { id: "Mamaw-PlayAI", name: "Mamaw", language: "en", gender: "female" },
  { id: "Mason-PlayAI", name: "Mason", language: "en", gender: "male" },
  { id: "Mikail-PlayAI", name: "Mikail", language: "en", gender: "male" },
  { id: "Mitch-PlayAI", name: "Mitch", language: "en", gender: "male" },
  { id: "Quinn-PlayAI", name: "Quinn", language: "en", gender: "neutral" },
  { id: "Thunder-PlayAI", name: "Thunder", language: "en", gender: "male" },
  // Arabic voices
  { id: "Ahmad-PlayAI", name: "Ahmad", language: "ar", gender: "male" },
  { id: "Amira-PlayAI", name: "Amira", language: "ar", gender: "female" },
  { id: "Khalid-PlayAI", name: "Khalid", language: "ar", gender: "male" },
  { id: "Nasser-PlayAI", name: "Nasser", language: "ar", gender: "male" },
]

const GROQ_TTS_MODELS: TTSModelOption[] = [
  { id: "playai-tts", name: "PlayAI TTS (English)", languages: ["en"] },
  { id: "playai-tts-arabic", name: "PlayAI TTS (Arabic)", languages: ["ar"] },
]

// Gemini TTS Voices
const GEMINI_TTS_VOICES: VoiceOption[] = [
  { id: "Zephyr", name: "Zephyr (Bright)", description: "Bright tone" },
  { id: "Puck", name: "Puck (Upbeat)", description: "Upbeat tone" },
  { id: "Charon", name: "Charon (Informative)", description: "Informative tone" },
  { id: "Kore", name: "Kore (Firm)", description: "Firm tone" },
  { id: "Fenrir", name: "Fenrir (Excitable)", description: "Excitable tone" },
  { id: "Leda", name: "Leda (Young)", description: "Young tone" },
  { id: "Orus", name: "Orus (Corporate)", description: "Corporate tone" },
  { id: "Aoede", name: "Aoede (Breezy)", description: "Breezy tone" },
  { id: "Callirrhoe", name: "Callirrhoe (Casual)", description: "Casual tone" },
  { id: "Autonoe", name: "Autonoe (Bright)", description: "Bright tone" },
  { id: "Enceladus", name: "Enceladus (Breathy)", description: "Breathy tone" },
  { id: "Iapetus", name: "Iapetus (Clear)", description: "Clear tone" },
  { id: "Umbriel", name: "Umbriel (Calm)", description: "Calm tone" },
  { id: "Algieba", name: "Algieba (Smooth)", description: "Smooth tone" },
  { id: "Despina", name: "Despina (Smooth)", description: "Smooth tone" },
  { id: "Erinome", name: "Erinome (Serene)", description: "Serene tone" },
  { id: "Algenib", name: "Algenib (Gravelly)", description: "Gravelly tone" },
  { id: "Rasalgethi", name: "Rasalgethi (Informative)", description: "Informative tone" },
  { id: "Laomedeia", name: "Laomedeia (Upbeat)", description: "Upbeat tone" },
  { id: "Achernar", name: "Achernar (Soft)", description: "Soft tone" },
  { id: "Alnilam", name: "Alnilam (Firm)", description: "Firm tone" },
  { id: "Schedar", name: "Schedar (Even)", description: "Even tone" },
  { id: "Gacrux", name: "Gacrux (Mature)", description: "Mature tone" },
  { id: "Pulcherrima", name: "Pulcherrima (Forward)", description: "Forward tone" },
  { id: "Achird", name: "Achird (Friendly)", description: "Friendly tone" },
  { id: "Zubenelgenubi", name: "Zubenelgenubi (Casual)", description: "Casual tone" },
  { id: "Vindemiatrix", name: "Vindemiatrix (Gentle)", description: "Gentle tone" },
  { id: "Sadachbia", name: "Sadachbia (Lively)", description: "Lively tone" },
  { id: "Sadaltager", name: "Sadaltager (Knowledgeable)", description: "Knowledgeable tone" },
  { id: "Sulafat", name: "Sulafat (Warm)", description: "Warm tone" },
]

const GEMINI_TTS_MODELS: TTSModelOption[] = [
  { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS" },
  { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS" },
]

// Fallback models for each provider
const OPENAI_FALLBACK_MODELS: ModelInfo[] = [
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
]

const GROQ_FALLBACK_MODELS: ModelInfo[] = [
  { id: "gemma2-9b-it", name: "Gemma2 9B IT" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
  { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B Versatile" },
  { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
]

const GEMINI_FALLBACK_MODELS: ModelInfo[] = [
  { id: "gemini-1.5-flash-002", name: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
  { id: "gemini-1.0-pro", name: "Gemini 1.0 Pro" },
]

// Provider definitions
export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI's GPT models and services",
    website: "https://openai.com",
    capabilities: {
      chat: true,
      stt: true,
      tts: true,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: true,
      maxContextLength: 128000,
    },
    defaultConfig: {
      baseUrl: "https://api.openai.com/v1",
      chat: {
        defaultModel: "gpt-4o-mini",
        mcpModel: "gpt-4o-mini",
        transcriptModel: "gpt-4o-mini",
        temperature: 0,
      },
      stt: {
        model: "whisper-1",
        language: "auto",
      },
      tts: {
        model: "tts-1",
        voice: "alloy",
        speed: 1.0,
        responseFormat: "mp3",
      },
      timeout: 30000,
      retryCount: 3,
      retryDelay: 1000,
    },
    models: {
      chat: OPENAI_FALLBACK_MODELS,
      tts: OPENAI_TTS_MODELS,
    },
    voices: OPENAI_TTS_VOICES,
    endpoints: {
      chat: "/chat/completions",
      stt: "/audio/transcriptions",
      tts: "/audio/speech",
      models: "/models",
    },
    auth: {
      apiKeyRequired: true,
      apiKeyName: "Authorization",
      customHeaders: {
        "Content-Type": "application/json",
      },
    },
    validators: {
      apiKey: (key: string) => key.startsWith("sk-") && key.length > 20,
      baseUrl: (url: string) => url.startsWith("http") && url.includes("api"),
    },
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Groq's fast inference models",
    website: "https://groq.com",
    capabilities: {
      chat: true,
      stt: true,
      tts: true,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: false,
      maxContextLength: 32768,
    },
    defaultConfig: {
      baseUrl: "https://api.groq.com/openai/v1",
      chat: {
        defaultModel: "llama-3.1-70b-versatile",
        mcpModel: "llama-3.1-70b-versatile",
        transcriptModel: "llama-3.1-70b-versatile",
        temperature: 0,
      },
      stt: {
        model: "whisper-large-v3",
        language: "auto",
      },
      tts: {
        model: "playai-tts",
        voice: "Fritz-PlayAI",
      },
      timeout: 30000,
      retryCount: 3,
      retryDelay: 1000,
    },
    models: {
      chat: GROQ_FALLBACK_MODELS,
      tts: GROQ_TTS_MODELS,
    },
    voices: GROQ_TTS_VOICES,
    endpoints: {
      chat: "/chat/completions",
      stt: "/audio/transcriptions",
      tts: "/audio/speech",
      models: "/models",
    },
    auth: {
      apiKeyRequired: true,
      apiKeyName: "Authorization",
      customHeaders: {
        "Content-Type": "application/json",
      },
    },
    validators: {
      apiKey: (key: string) => key.startsWith("gsk_") && key.length > 20,
      baseUrl: (url: string) => url.startsWith("http") && url.includes("groq"),
    },
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    description: "Google's Gemini models",
    website: "https://ai.google.dev",
    capabilities: {
      chat: true,
      stt: false,
      tts: true,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: false,
      maxContextLength: 1000000,
    },
    defaultConfig: {
      baseUrl: "https://generativelanguage.googleapis.com",
      chat: {
        defaultModel: "gemini-1.5-flash-002",
        mcpModel: "gemini-1.5-flash-002",
        transcriptModel: "gemini-1.5-flash-002",
        temperature: 0,
      },
      tts: {
        model: "gemini-2.5-flash-preview-tts",
        voice: "Kore",
      },
      timeout: 30000,
      retryCount: 3,
      retryDelay: 1000,
    },
    models: {
      chat: GEMINI_FALLBACK_MODELS,
      tts: GEMINI_TTS_MODELS,
    },
    voices: GEMINI_TTS_VOICES,
    endpoints: {
      chat: "/v1beta/models/{model}:generateContent",
      tts: "/v1beta/models/{model}:generateContent",
      models: "/v1beta/models",
    },
    auth: {
      apiKeyRequired: true,
      apiKeyName: "key",
      customHeaders: {
        "Content-Type": "application/json",
      },
    },
    validators: {
      apiKey: (key: string) => key.length > 20,
      baseUrl: (url: string) => url.startsWith("http") && url.includes("googleapis"),
    },
  },
}

// Export individual provider definitions
export const OPENAI_PROVIDER = PROVIDER_DEFINITIONS.openai
export const GROQ_PROVIDER = PROVIDER_DEFINITIONS.groq
export const GEMINI_PROVIDER = PROVIDER_DEFINITIONS.gemini

// Export provider lists for UI
export const ALL_PROVIDERS = Object.values(PROVIDER_DEFINITIONS)
export const CHAT_PROVIDERS = ALL_PROVIDERS.filter(p => p.capabilities.chat)
export const STT_PROVIDERS = ALL_PROVIDERS.filter(p => p.capabilities.stt)
export const TTS_PROVIDERS = ALL_PROVIDERS.filter(p => p.capabilities.tts)
