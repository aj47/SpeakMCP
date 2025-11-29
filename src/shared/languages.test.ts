import { describe, it, expect, vi } from 'vitest'
import {
  SUPPORTED_LANGUAGES,
  OPENAI_WHISPER_SUPPORTED_LANGUAGES,
  GROQ_WHISPER_SUPPORTED_LANGUAGES,
  getLanguageName,
  getLanguageNativeName,
  isValidLanguageCode,
  isValidLanguageForProvider,
  getApiLanguageCode,
  getSupportedLanguagesForProvider,
} from './languages'

describe('languages', () => {
  it('gets language names and native names', () => {
    expect(getLanguageName('en')).toBe('English')
    expect(getLanguageNativeName('es')).toBe('Español')
    expect(getLanguageName('xx')).toBe('xx')
  })

  it('validates ISO codes', () => {
    expect(isValidLanguageCode('auto')).toBe(true)
    expect(isValidLanguageCode('en')).toBe(true)
    expect(isValidLanguageCode('xx')).toBe(false)
  })

  it('validates language per provider', () => {
    expect(isValidLanguageForProvider('en', 'openai')).toBe(true)
    expect(isValidLanguageForProvider('en', 'groq')).toBe(true)
    expect(isValidLanguageForProvider('xx', 'openai')).toBe(false)
    expect(isValidLanguageForProvider('xx', 'unknown')).toBe(false)
  })

  it('returns API language code or undefined and warns when unsupported by provider', () => {
    expect(getApiLanguageCode('auto')).toBeUndefined()
    expect(getApiLanguageCode('en')).toBe('en')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getApiLanguageCode('xx', 'openai')).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('lists supported languages for provider including auto', () => {
    const openaiLangs = getSupportedLanguagesForProvider('openai')
    const groqLangs = getSupportedLanguagesForProvider('groq')

    // Must include auto
    expect(openaiLangs.find(l => l.code === 'auto')).toBeTruthy()
    expect(groqLangs.find(l => l.code === 'auto')).toBeTruthy()

    // Should include each provider's supported codes
    for (const code of OPENAI_WHISPER_SUPPORTED_LANGUAGES) {
      expect(openaiLangs.find(l => l.code === code)).toBeTruthy()
    }
    for (const code of GROQ_WHISPER_SUPPORTED_LANGUAGES) {
      expect(groqLangs.find(l => l.code === code)).toBeTruthy()
    }

    // Unknown provider falls back to full list
    const unknown = getSupportedLanguagesForProvider('unknown')
    expect(unknown.length).toBe(SUPPORTED_LANGUAGES.length)
  })
})

