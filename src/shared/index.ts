export const STT_PROVIDERS = [
  {
    label: "OpenAI",
    value: "openai",
  },
  {
    label: "Groq",
    value: "groq",
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
  {
    label: "Cerebras",
    value: "cerebras",
  },
] as const

export type CHAT_PROVIDER_ID = (typeof CHAT_PROVIDERS)[number]["value"]

export const TTS_PROVIDERS = [
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
  {
    label: "Cerebras",
    value: "cerebras",
  },
] as const

export type TTS_PROVIDER_ID = (typeof TTS_PROVIDERS)[number]["value"]

// OpenAI TTS Voice Options
export const OPENAI_TTS_VOICES = [
  { label: "Alloy", value: "alloy" },
  { label: "Echo", value: "echo" },
  { label: "Fable", value: "fable" },
  { label: "Onyx", value: "onyx" },
  { label: "Nova", value: "nova" },
  { label: "Shimmer", value: "shimmer" },
] as const

export const OPENAI_TTS_MODELS = [
  { label: "TTS-1 (Standard)", value: "tts-1" },
  { label: "TTS-1-HD (High Quality)", value: "tts-1-hd" },
] as const

// Groq TTS Voice Options (English)
export const GROQ_TTS_VOICES_ENGLISH = [
  { label: "Arista", value: "Arista-PlayAI" },
  { label: "Atlas", value: "Atlas-PlayAI" },
  { label: "Basil", value: "Basil-PlayAI" },
  { label: "Briggs", value: "Briggs-PlayAI" },
  { label: "Calum", value: "Calum-PlayAI" },
  { label: "Celeste", value: "Celeste-PlayAI" },
  { label: "Cheyenne", value: "Cheyenne-PlayAI" },
  { label: "Chip", value: "Chip-PlayAI" },
  { label: "Cillian", value: "Cillian-PlayAI" },
  { label: "Deedee", value: "Deedee-PlayAI" },
  { label: "Fritz", value: "Fritz-PlayAI" },
  { label: "Gail", value: "Gail-PlayAI" },
  { label: "Indigo", value: "Indigo-PlayAI" },
  { label: "Mamaw", value: "Mamaw-PlayAI" },
  { label: "Mason", value: "Mason-PlayAI" },
  { label: "Mikail", value: "Mikail-PlayAI" },
  { label: "Mitch", value: "Mitch-PlayAI" },
  { label: "Quinn", value: "Quinn-PlayAI" },
  { label: "Thunder", value: "Thunder-PlayAI" },
] as const

// Groq TTS Voice Options (Arabic)
export const GROQ_TTS_VOICES_ARABIC = [
  { label: "Ahmad", value: "Ahmad-PlayAI" },
  { label: "Amira", value: "Amira-PlayAI" },
  { label: "Khalid", value: "Khalid-PlayAI" },
  { label: "Nasser", value: "Nasser-PlayAI" },
] as const

export const GROQ_TTS_MODELS = [
  { label: "PlayAI TTS (English)", value: "playai-tts" },
  { label: "PlayAI TTS (Arabic)", value: "playai-tts-arabic" },
] as const

// Gemini TTS Voice Options (30 voices)
export const GEMINI_TTS_VOICES = [
  { label: "Zephyr (Bright)", value: "Zephyr" },
  { label: "Puck (Upbeat)", value: "Puck" },
  { label: "Charon (Informative)", value: "Charon" },
  { label: "Kore (Firm)", value: "Kore" },
  { label: "Fenrir (Excitable)", value: "Fenrir" },
  { label: "Leda (Young)", value: "Leda" },
  { label: "Orus (Corporate)", value: "Orus" },
  { label: "Aoede (Breezy)", value: "Aoede" },
  { label: "Callirrhoe (Casual)", value: "Callirrhoe" },
  { label: "Autonoe (Bright)", value: "Autonoe" },
  { label: "Enceladus (Breathy)", value: "Enceladus" },
  { label: "Iapetus (Clear)", value: "Iapetus" },
  { label: "Umbriel (Calm)", value: "Umbriel" },
  { label: "Algieba (Smooth)", value: "Algieba" },
  { label: "Despina (Smooth)", value: "Despina" },
  { label: "Erinome (Serene)", value: "Erinome" },
  { label: "Algenib (Gravelly)", value: "Algenib" },
  { label: "Rasalgethi (Informative)", value: "Rasalgethi" },
  { label: "Laomedeia (Upbeat)", value: "Laomedeia" },
  { label: "Achernar (Soft)", value: "Achernar" },
  { label: "Alnilam (Firm)", value: "Alnilam" },
  { label: "Schedar (Even)", value: "Schedar" },
  { label: "Gacrux (Mature)", value: "Gacrux" },
  { label: "Pulcherrima (Forward)", value: "Pulcherrima" },
  { label: "Achird (Friendly)", value: "Achird" },
  { label: "Zubenelgenubi (Casual)", value: "Zubenelgenubi" },
  { label: "Vindemiatrix (Gentle)", value: "Vindemiatrix" },
  { label: "Sadachbia (Lively)", value: "Sadachbia" },
  { label: "Sadaltager (Knowledgeable)", value: "Sadaltager" },
  { label: "Sulafat (Warm)", value: "Sulafat" },
] as const

export const GEMINI_TTS_MODELS = [
  { label: "Gemini 2.5 Flash TTS", value: "gemini-2.5-flash-preview-tts" },
  { label: "Gemini 2.5 Pro TTS", value: "gemini-2.5-pro-preview-tts" },
] as const
