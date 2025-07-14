export const STT_PROVIDERS = [
  {
    label: "OpenAI",
    value: "openai",
  },
  {
    label: "Groq",
    value: "groq",
  },
  {
    label: "Lightning Whisper MLX",
    value: "lightning-whisper-mlx",
  },
] as const

export type STT_PROVIDER_ID = (typeof STT_PROVIDERS)[number]["value"]

export const CHAT_PROVIDERS = [
  {
    label: "OpenAI",
    value: "openai",
  },
  {
    label: "Groq",
    value: "groq",
  },
  {
    label: "Gemini",
    value: "gemini",
  },
] as const

export type CHAT_PROVIDER_ID = (typeof CHAT_PROVIDERS)[number]["value"]
