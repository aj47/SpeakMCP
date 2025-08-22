/**
 * Text preprocessing utilities for Text-to-Speech (TTS)
 * Converts technical content into speech-friendly text
 */

export interface TTSPreprocessingOptions {
  removeCodeBlocks?: boolean
  removeUrls?: boolean
  convertMarkdown?: boolean
  removeSymbols?: boolean
  convertNumbers?: boolean
  maxLength?: number
}

const DEFAULT_OPTIONS: TTSPreprocessingOptions = {
  removeCodeBlocks: true,
  removeUrls: true,
  convertMarkdown: true,
  removeSymbols: true,
  convertNumbers: true,
  maxLength: 4000, // Reasonable limit for TTS
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

/**
 * Removes code blocks and replaces them with descriptive text
 */
function removeCodeBlocks(text: string): string {
  // Remove fenced code blocks (```...```)
  text = text.replace(/```[\s\S]*?```/g, " [code block] ")
  
  // Remove inline code (`...`)
  text = text.replace(/`([^`]+)`/g, " $1 ")
  
  // Remove HTML/XML tags
  text = text.replace(/<[^>]*>/g, " ")
  
  return text
}

/**
 * Removes URLs and replaces them with descriptive text
 */
function removeUrls(text: string): string {
  // Replace URLs with descriptive text
  text = text.replace(
    /https?:\/\/[^\s]+/g,
    " [web link] "
  )
  
  // Replace email addresses
  text = text.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    " [email address] "
  )
  
  return text
}

/**
 * Converts markdown formatting to speech-friendly equivalents
 */
function convertMarkdownToSpeech(text: string): string {
  // Convert headers to spoken form
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "Heading: $1.")
  
  // Convert bold text
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1")
  text = text.replace(/__([^_]+)__/g, "$1")
  
  // Convert italic text
  text = text.replace(/\*([^*]+)\*/g, "$1")
  text = text.replace(/_([^_]+)_/g, "$1")
  
  // Convert lists to spoken form
  text = text.replace(/^\s*[-*+]\s+(.+)$/gm, "Item: $1.")
  text = text.replace(/^\s*\d+\.\s+(.+)$/gm, "Item: $1.")
  
  // Convert links [text](url) to just text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  
  // Remove remaining markdown syntax
  text = text.replace(/[*_`~]/g, "")
  
  return text
}

/**
 * Cleans up symbols that don't read well in speech
 */
function cleanSymbols(text: string): string {
  // Replace common programming symbols with words
  const symbolReplacements: Record<string, string> = {
    "&": " and ",
    "@": " at ",
    "#": " hash ",
    "%": " percent ",
    "++": " plus plus ",
    "--": " minus minus ",
    "=>": " arrow ",
    "->": " arrow ",
    "===": " equals ",
    "!==": " not equals ",
    ">=": " greater than or equal ",
    "<=": " less than or equal ",
    "&&": " and ",
    "||": " or ",
    "!=": " not equal ",
    "==": " equals ",
  }

  for (const [symbol, replacement] of Object.entries(symbolReplacements)) {
    text = text.replace(new RegExp(escapeRegExp(symbol), "g"), replacement)
  }

  // Remove excessive punctuation
  text = text.replace(/[!]{2,}/g, "!")
  text = text.replace(/[?]{2,}/g, "?")
  text = text.replace(/[.]{3,}/g, "...")
  
  // Clean up brackets and parentheses content that might be technical
  text = text.replace(/\([^)]*\)/g, "")
  text = text.replace(/\[[^\]]*\]/g, "")
  
  return text
}

/**
 * Converts numbers to more speech-friendly formats
 */
function convertNumbers(text: string): string {
  // Convert version numbers (e.g., "v1.2.3" -> "version 1 point 2 point 3")
  text = text.replace(/v?(\d+)\.(\d+)\.(\d+)/g, "version $1 point $2 point $3")
  
  // Convert decimal numbers to spoken form
  text = text.replace(/(\d+)\.(\d+)/g, "$1 point $2")
  
  // Convert large numbers with commas
  text = text.replace(/(\d{1,3}),(\d{3})/g, "$1 thousand $2")
  
  return text
}

/**
 * Normalizes whitespace and cleans up the text
 */
function normalizeWhitespace(text: string): string {
  // Replace multiple spaces with single space
  text = text.replace(/\s+/g, " ")
  
  // Remove leading/trailing whitespace
  text = text.trim()
  
  // Ensure sentences end with proper punctuation
  text = text.replace(/([a-zA-Z0-9])\s*$/, "$1.")
  
  // Add pauses after sentences for better speech flow
  text = text.replace(/([.!?])\s+/g, "$1 ")
  
  return text
}

/**
 * Truncates text at a reasonable sentence boundary
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  // Try to truncate at sentence boundary
  const truncated = text.substring(0, maxLength)
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?")
  )

  if (lastSentenceEnd > maxLength * 0.7) {
    return truncated.substring(0, lastSentenceEnd + 1)
  }

  // Fallback: truncate at word boundary
  const lastSpace = truncated.lastIndexOf(" ")
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + "..."
  }

  return truncated + "..."
}

/**
 * Escapes special regex characters
 */
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
