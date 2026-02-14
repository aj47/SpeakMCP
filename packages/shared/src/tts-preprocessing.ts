/**
 * Text preprocessing utilities for Text-to-Speech (TTS)
 * Converts technical content into speech-friendly text
 * 
 * This module is shared between desktop and mobile apps to ensure
 * consistent TTS output across platforms.
 */

import { removeUrlsAndEmails } from './url-utils'

export interface TTSPreprocessingOptions {
  removeCodeBlocks?: boolean
  removeUrls?: boolean
  convertMarkdown?: boolean
  removeSymbols?: boolean
  convertNumbers?: boolean
  maxLength?: number
  removeThinkingBlocks?: boolean
}

const DEFAULT_OPTIONS: TTSPreprocessingOptions = {
  removeCodeBlocks: true,
  removeUrls: true,
  convertMarkdown: true,
  removeSymbols: true,
  convertNumbers: true,
  maxLength: 4000, // Reasonable limit for TTS
  removeThinkingBlocks: true,
}

/**
 * Preprocesses text to make it more suitable for text-to-speech conversion
 */
export function preprocessTextForTTS(
  text: string,
  options: TTSPreprocessingOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let processedText = text

  // Remove thinking blocks first (before other processing)
  if (opts.removeThinkingBlocks) {
    processedText = removeThinkingBlocks(processedText)
  }

  // Remove or replace code blocks
  if (opts.removeCodeBlocks) {
    processedText = removeCodeBlocks(processedText)
  }

  // Remove or replace URLs
  if (opts.removeUrls) {
    processedText = removeUrls(processedText)
  }

  // Convert markdown formatting to speech-friendly text
  if (opts.convertMarkdown) {
    processedText = convertMarkdownToSpeech(processedText)
  }

  // Remove or replace problematic symbols
  if (opts.removeSymbols) {
    processedText = cleanSymbols(processedText)
  }

  // Convert numbers to spoken form
  if (opts.convertNumbers) {
    processedText = convertNumbers(processedText)
  }

  // Clean up whitespace and normalize
  processedText = normalizeWhitespace(processedText)

  // Truncate if too long
  if (opts.maxLength && processedText.length > opts.maxLength) {
    processedText = truncateText(processedText, opts.maxLength)
  }

  return processedText
}

/** Removes thinking blocks (<think>...</think>/** Removes thinking blocks (<think>…</think>, <thinking>…</thinking>) from text */
export function removeThinkingBlocks(text: string): string {
  // Remove XML-style thinking/think blocks and their content (case-insensitive)
  let result = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
  result = result.replace(/<think>[\s\S]*?<\/think>/gi, "")
  return result
}

/** Removes code blocks and replaces them with descriptive text */
export function removeCodeBlocks(text: string): string {
  text = text.replace(/```[\s\S]*?```/g, " [code block] ")
  text = text.replace(/`([^`]+)`/g, " $1 ")
  text = text.replace(/<[^>]*>/g, " ")
  return text
}

/** Removes URLs and replaces them with descriptive text */
export function removeUrls(text: string): string {
  return removeUrlsAndEmails(text)
}

/** Converts markdown formatting to speech-friendly equivalents */
export function convertMarkdownToSpeech(text: string): string {
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "Heading: $1.")
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1")
  text = text.replace(/__([^_]+)__/g, "$1")
  text = text.replace(/\*([^*]+)\*/g, "$1")
  text = text.replace(/_([^_]+)_/g, "$1")
  text = text.replace(/^\s*[-*+]\s+(.+)$/gm, "Item: $1.")
  text = text.replace(/^\s*\d+\.\s+(.+)$/gm, "Item: $1.")
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  text = text.replace(/[*_`~]/g, "")
  return text
}

/** Cleans up symbols that don't read well in speech */
export function cleanSymbols(text: string): string {
  const symbolReplacements: Record<string, string> = {
    "&": " and ", "@": " at ", "#": " hash ", "%": " percent ",
    "++": " plus plus ", "--": " minus minus ", "=>": " arrow ", "->": " arrow ",
    "===": " equals ", "!==": " not equals ", ">=": " greater than or equal ",
    "<=": " less than or equal ", "&&": " and ", "||": " or ",
    "!=": " not equal ", "==": " equals ",
  }
  for (const [symbol, replacement] of Object.entries(symbolReplacements)) {
    text = text.replace(new RegExp(escapeRegExp(symbol), "g"), replacement)
  }
  text = text.replace(/[!]{2,}/g, "!")
  text = text.replace(/[?]{2,}/g, "?")
  text = text.replace(/[.]{3,}/g, "...")
  text = text.replace(/\([^)]*\)/g, "")
  // Remove brackets but preserve TTS placeholders like [code block], [web link], [email address]
  text = text.replace(/\[(?!code block\]|web link\]|email address\])[^\]]*\]/g, "")
  return text
}

/** Converts currency amounts to speech-friendly format
 * @example "$1,234.56" → "1234 dollars 56 cents"
 * @example "€500" → "500 euros"
 * @example "£50.99" → "50 pounds 99 pence"
 * @example "100 EUR" → "100 euros"
 */
export function convertCurrency(text: string): string {
  // Handle USD ($) with amounts: $50, $50.25
  text = text.replace(/\$(\s?)(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (_match, _space, amount) => {
    const cleaned = amount.replace(/,/g, "")
    const parts = cleaned.split(".")
    if (parts.length === 2 && parts[1].length === 2) {
      return `${parts[0]} dollars ${parts[1]} cents`
    }
    return `${cleaned} dollars`
  })

  // Handle EUR (€) with amounts: €50, €50.25
  text = text.replace(/€(\s?)(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (_match, _space, amount) => {
    const cleaned = amount.replace(/,/g, "")
    const parts = cleaned.split(".")
    if (parts.length === 2 && parts[1].length === 2) {
      return `${parts[0]} euros ${parts[1]} cents`
    }
    return `${cleaned} euros`
  })

  // Handle GBP (£) with amounts: £50, £50.99
  text = text.replace(/£(\s?)(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (_match, _space, amount) => {
    const cleaned = amount.replace(/,/g, "")
    const parts = cleaned.split(".")
    if (parts.length === 2 && parts[1].length === 2) {
      return `${parts[0]} pounds ${parts[1]} pence`
    }
    return `${cleaned} pounds`
  })

  // Handle JPY (¥) with amounts: ¥1000 (yen doesn't use cents)
  text = text.replace(/¥(\s?)(\d+(?:,\d{3})*)/g, (_match, _space, amount) => {
    const cleaned = amount.replace(/,/g, "")
    return `${cleaned} yen`
  })

  // Handle explicit currency codes: 50.99 USD → "50 dollars 99 cents USD"
  // Handle decimals: 50.99 USD → "50 dollars 99 cents USD"
  text = text.replace(/(\d+)\.(\d+)\s*(USD|dollars?)\b/gi, "$1 dollars $2 cents $3")
  text = text.replace(/(\d+)\s*(USD|dollars?)\b/gi, "$1 dollars")

  // Handle EUR with decimals: 50.99 EUR → "50 euros 99 cents"
  text = text.replace(/(\d+)\.(\d+)\s*(EUR|euros?)\b/gi, "$1 euros $2 cents")
  text = text.replace(/(\d+)\s*(EUR|euros?)\b/gi, "$1 euros")

  // Handle GBP with decimals: 75.50 GBP → "75 pounds 50 pence"
  text = text.replace(/(\d+)\.(\d+)\s*(GBP|pounds?)\b/gi, "$1 pounds $2 pence")
  text = text.replace(/(\d+)\s*(GBP|pounds?)\b/gi, "$1 pounds")

  // Handle JPY: 1000 JPY → "1000 yen"
  text = text.replace(/(\d+)\s*(JPY|yens?)\b/gi, "$1 yen")
  
  // Clean up any remaining extra spaces
  text = text.replace(/\s+/g, " ")
  
  return text
}

/** Converts numbers to more speech-friendly formats */
export function convertNumbers(text: string): string {
  // Version numbers: v1.2.3 or 1.2.3 → "version 1 point 2 point 3"
  text = text.replace(/v?(\d+)\.(\d+)\.(\d+)/g, "version $1 point $2 point $3")

  // Currency conversion first (delegate to convertCurrency) - must run before decimal regex
  text = convertCurrency(text)

  // Decimal numbers with dots: 3.14 → "3 point 14" (only for non-currency amounts now)
  text = text.replace(/(\d+)\.(\d+)/g, "$1 point $2")

  // Phone numbers: (123) 456-7890 → "123 456 7890", 123-456-7890 → "123 456 7890"
  text = text.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, (match) => match.replace(/[-.\s()]/g, " "))

  // Percentages: 50% → "50 percent", 12.5% → "12 point 5 percent"
  text = text.replace(/(\d+(\.\d+)?)\s*%/g, "$1 percent")

  // Ordinal numbers: 1st, 2nd, 3rd, 4th → "1st", "2nd", etc. (keep as-is for TTS to handle)

  // Remove commas from numbers - TTS engines pronounce large numbers naturally
  // Use lookahead to match any comma between digits (handles 1,234,567,890 etc.)
  text = text.replace(/(\d),(?=\d)/g, "$1")

  return text
}

/** Normalizes whitespace and cleans up the text */
export function normalizeWhitespace(text: string): string {
  text = text.replace(/\s+/g, " ")
  text = text.trim()
  // Only add trailing period if text ends with alphanumeric and doesn't already end with punctuation
  text = text.replace(/([a-zA-Z0-9])\s*$/, "$1.")
  text = text.replace(/([.!?])\s+/g, "$1 ")
  return text
}

/** Truncates text at a reasonable sentence boundary */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.substring(0, maxLength)
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."), truncated.lastIndexOf("!"), truncated.lastIndexOf("?")
  )
  if (lastSentenceEnd > maxLength * 0.7) return truncated.substring(0, lastSentenceEnd + 1)
  const lastSpace = truncated.lastIndexOf(" ")
  if (lastSpace > maxLength * 0.8) return truncated.substring(0, lastSpace) + "..."
  return truncated + "..."
}

/** Escapes special regex characters */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Validates if text is suitable for TTS after preprocessing
 */
export function validateTTSText(text: string): {
  isValid: boolean
  issues: string[]
  processedLength: number
} {
  const issues: string[] = []

  if (!text || text.trim().length === 0) {
    issues.push("Text is empty")
  }

  if (text.length > 10000) {
    issues.push("Text is too long for TTS")
  }

  // Check for remaining problematic content
  if (text.includes("```")) {
    issues.push("Contains unprocessed code blocks")
  }

  if (/https?:\/\//.test(text)) {
    issues.push("Contains unprocessed URLs")
  }

  return {
    isValid: issues.length === 0,
    issues,
    processedLength: text.length,
  }
}

