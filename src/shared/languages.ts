// Language support for speech-to-text recognition
// Based on ISO 639-1 language codes

export interface LanguageOption {
  code: string
  name: string
  nativeName: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", name: "Auto-detect", nativeName: "Auto-detect" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "bg", name: "Bulgarian", nativeName: "Български" },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski" },
  { code: "sr", name: "Serbian", nativeName: "Српски" },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina" },
  { code: "et", name: "Estonian", nativeName: "Eesti" },
  { code: "lv", name: "Latvian", nativeName: "Latviešu" },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių" },
  { code: "mt", name: "Maltese", nativeName: "Malti" },
]

// ISO 639-1 language codes that are supported by OpenAI Whisper
export const OPENAI_WHISPER_SUPPORTED_LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "ru", "ja", "ko", "zh",
  "ar", "hi", "tr", "nl", "sv", "no", "da", "fi", "pl", "uk",
  "el", "he", "th", "vi", "id", "ms", "cs", "sk", "hu", "ro",
  "bg", "hr", "sr", "sl", "et", "lv", "lt", "mt"
]

// ISO 639-1 language codes that are supported by Groq Whisper
export const GROQ_WHISPER_SUPPORTED_LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "ru", "ja", "ko", "zh",
  "ar", "hi", "tr", "nl", "sv", "no", "da", "fi", "pl", "uk",
  "el", "he", "th", "vi", "id", "ms", "cs", "sk", "hu", "ro",
  "bg", "hr", "sr", "sl", "et", "lv", "lt", "mt"
]

export const getLanguageName = (code: string): string => {
  const language = SUPPORTED_LANGUAGES.find(lang => lang.code === code)
  return language ? language.name : code
}

export const getLanguageNativeName = (code: string): string => {
  const language = SUPPORTED_LANGUAGES.find(lang => lang.code === code)
  return language ? language.nativeName : code
}

// Validate ISO 639-1 language code
export const isValidLanguageCode = (code: string): boolean => {
  if (code === "auto") return true
  return SUPPORTED_LANGUAGES.some(lang => lang.code === code)
}

// Validate language code for specific providers
export const isValidLanguageForProvider = (code: string, provider: string): boolean => {
  if (code === "auto") return true

  switch (provider) {
    case "openai":
      return OPENAI_WHISPER_SUPPORTED_LANGUAGES.includes(code)
    case "groq":
      return GROQ_WHISPER_SUPPORTED_LANGUAGES.includes(code)
    default:
      return isValidLanguageCode(code)
  }
}

// Get language code for API calls with provider-specific validation
export const getApiLanguageCode = (language: string, provider?: string): string | undefined => {
  if (language === "auto" || !language) {
    return undefined
  }

  if (provider && !isValidLanguageForProvider(language, provider)) {
    console.warn(`Language code ${language} may not be supported by ${provider}`)
  }

  return isValidLanguageCode(language) ? language : undefined
}

// Get supported languages for a specific provider
export const getSupportedLanguagesForProvider = (provider: string): LanguageOption[] => {
  switch (provider) {
    case "openai":
      return SUPPORTED_LANGUAGES.filter(lang =>
        lang.code === "auto" || OPENAI_WHISPER_SUPPORTED_LANGUAGES.includes(lang.code)
      )
    case "groq":
      return SUPPORTED_LANGUAGES.filter(lang =>
        lang.code === "auto" || GROQ_WHISPER_SUPPORTED_LANGUAGES.includes(lang.code)
      )
    default:
      return SUPPORTED_LANGUAGES
  }
}
