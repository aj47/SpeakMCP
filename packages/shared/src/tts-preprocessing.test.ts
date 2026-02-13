/**
 * TTS Preprocessing Tests
 * 
 * Tests for the shared tts-preprocessing module used by SpeakMCP
 * for preparing text-to-speech content.
 */

import { describe, it, expect } from "vitest"
import {
  removeThinkingBlocks,
  removeCodeBlocks,
  removeUrls,
  convertMarkdownToSpeech,
  cleanSymbols,
  convertNumbers,
  convertCurrency,
  normalizeWhitespace,
  truncateText,
  validateTTSText,
  preprocessTextForTTS,
} from "./tts-preprocessing"

describe("removeThinkingBlocks", () => {
  it("should remove thinking blocks with default tags", () => {
    const input = "Answer here. thinking goes here. More answer."
    const result = removeThinkingBlocks(input)
    expect(result).toBe("Answer here.  More answer.")
  })

  it("should remove multiline thinking blocks", () => {
    const input = `First part.
Thinking across multiple lines.
</think>
Second part.`
    const result = removeThinkingBlocks(input)
    expect(result).toBe("First part.\nSecond part.")
  })

  it("should remove multiple thinking blocks", () => {
    const input = "A. First reasoning. B. Second reasoning. C."
    const result = removeThinkingBlocks(input)
    expect(result).toBe("A. B. C.")
  })

  it("should handle case-insensitive tags", () => {
    const input = "Answer. <THINK>Reasoning</THINK> More."
    const result = removeThinkingBlocks(input)
    expect(result).toBe("Answer.  More.")
  })

  it("should return original text if no thinking blocks", () => {
    const input = "Plain text without any thinking blocks."
    const result = removeThinkingBlocks(input)
    expect(result).toBe(input)
  })
})

describe("removeCodeBlocks", () => {
  it("should replace code blocks with placeholder", () => {
    const input = "```js\nconst x = 1;\n```"
    const result = removeCodeBlocks(input)
    expect(result).toContain("[code block]")
  })

  it("should replace inline code with placeholder", () => {
    const input = "Use `console.log()` to debug."
    const result = removeCodeBlocks(input)
    expect(result).toContain(" console.log() ")
  })

  it("should remove HTML tags", () => {
    const input = "<div>Content</div>"
    const result = removeCodeBlocks(input)
    expect(result).not.toContain("<div>")
    expect(result).not.toContain("</div>")
  })

  it("should handle multiple code blocks", () => {
    const input = "```js\na\n``` middle ```python\nb\n``` end"
    const result = removeCodeBlocks(input)
    expect(result).toContain("[code block]")
    expect(result).toContain("middle")
    expect(result).toContain("end")
  })
})

describe("removeUrls", () => {
  it("should replace HTTP URLs with placeholder", () => {
    const input = "Visit https://example.com for details."
    const result = removeUrls(input)
    expect(result).toContain("[web link]")
    expect(result).not.toContain("https://")
  })

  it("should replace email addresses with placeholder", () => {
    const input = "Contact hello@example.com"
    const result = removeUrls(input)
    expect(result).toContain("[email address]")
    expect(result).not.toContain("@")
  })

  it("should handle multiple URLs and emails", () => {
    const input = "Visit https://a.com and b@c.com"
    const result = removeUrls(input)
    const linkCount = (result.match(/\[web link\]/g) || []).length
    const emailCount = (result.match(/\[email address\]/g) || []).length
    expect(linkCount).toBe(1)
    expect(emailCount).toBe(1)
  })

  it("should preserve text around URLs", () => {
    const input = "Before https://example.com After"
    const result = removeUrls(input)
    expect(result).toContain("Before")
    expect(result).toContain("After")
  })
})

describe("convertMarkdownToSpeech", () => {
  it("should convert headings to speech format", () => {
    const input = "# Main Title"
    const result = convertMarkdownToSpeech(input)
    expect(result).toContain("Heading:")
    expect(result).not.toContain("#")
  })

  it("should remove bold formatting", () => {
    const input = "**bold text**"
    const result = convertMarkdownToSpeech(input)
    expect(result).toContain("bold text")
    expect(result).not.toContain("**")
  })

  it("should remove italic formatting", () => {
    const input = "*italic text*"
    const result = convertMarkdownToSpeech(input)
    expect(result).toContain("italic text")
    expect(result).not.toContain("*")
  })

  it("should convert list items to speech format", () => {
    const input = "- First item"
    const result = convertMarkdownToSpeech(input)
    expect(result).toContain("Item:")
  })

  it("should convert numbered lists", () => {
    const input = "1. First item"
    const result = convertMarkdownToSpeech(input)
    expect(result).toContain("Item:")
  })

  it("should extract link text", () => {
    const input = "[link text](https://example.com)"
    const result = convertMarkdownToSpeech(input)
    expect(result).toContain("link text")
    expect(result).not.toContain("(")
  })
})

describe("cleanSymbols", () => {
  it("should replace operators with speech-friendly text", () => {
    const input = "a >= b && c != d"
    const result = cleanSymbols(input)
    expect(result).toContain("greater than or equal")
    expect(result).toContain("and")
    expect(result).toContain("not equal")
  })

  it("should handle arrows", () => {
    const input = "x => y"
    const result = cleanSymbols(input)
    expect(result).toContain("arrow")
  })

  it("should replace @ symbol", () => {
    const input = "Contact @username"
    const result = cleanSymbols(input)
    expect(result).toContain(" at ")
  })

  it("should preserve TTS placeholders", () => {
    const input = "[code block] test [web link]"
    const result = cleanSymbols(input)
    expect(result).toContain("[code block]")
    expect(result).toContain("[web link]")
  })

  it("should remove other bracketed content", () => {
    const input = "[note] preserved [code block]"
    const result = cleanSymbols(input)
    expect(result).not.toContain("[note]")
    expect(result).toContain("[code block]")
  })

  it("should collapse multiple exclamation marks", () => {
    const input = "Wow!!!"
    const result = cleanSymbols(input)
    expect(result).toBe("!")
  })

  it("should replace percentages", () => {
    const input = "50% complete"
    const result = cleanSymbols(input)
    expect(result).toContain("percent")
  })
})

describe("convertNumbers", () => {
  it("should convert version numbers", () => {
    const input = "v1.2.3"
    const result = convertNumbers(input)
    expect(result).toContain("version 1 point 2 point 3")
  })

  it("should convert version numbers without v prefix", () => {
    const input = "2.0.0"
    const result = convertNumbers(input)
    expect(result).toContain("version 2 point 0 point 0")
  })

  it("should handle phone numbers", () => {
    const input = "Call (123) 456-7890"
    const result = convertNumbers(input)
    expect(result).not.toContain("(")
    expect(result).not.toContain(")")
    expect(result).not.toContain("-")
  })

  it("should convert currency", () => {
    const input = "$50.25"
    const result = convertNumbers(input)
    expect(result).toContain("50 dollars 25 cents")
  })

  it("should handle euros", () => {
    const input = "100 EUR"
    const result = convertNumbers(input)
    expect(result).toContain("100 euros")
  })

  it("should convert percentages", () => {
    const input = "75%"
    const result = convertNumbers(input)
    expect(result).toContain("75 percent")
  })

  it("should remove commas from large numbers", () => {
    const input = "1,234,567"
    const result = convertNumbers(input)
    expect(result).not.toContain(",")
    expect(result).toContain("1234567")
  })
})

describe("normalizeWhitespace", () => {
  it("should collapse multiple spaces", () => {
    const input = "Hello    world"
    const result = normalizeWhitespace(input)
    expect(result).toBe("Hello world")
  })

  it("should trim start and end", () => {
    const input = "  trimmed  "
    const result = normalizeWhitespace(input)
    expect(result).toBe("trimmed.")
  })

  it("should add period if missing", () => {
    const input = "No period"
    const result = normalizeWhitespace(input)
    expect(result).toContain(".")
  })

  it("should not add period if already present", () => {
    const input = "Has period."
    const result = normalizeWhitespace(input)
    expect(result).toBe("Has period.")
  })

  it("should normalize newlines to spaces", () => {
    const input = "Line1\nLine2"
    const result = normalizeWhitespace(input)
    expect(result).toBe("Line1 Line2.")
  })
})

describe("truncateText", () => {
  it("should return original if under max length", () => {
    const input = "Short text"
    const result = truncateText(input, 100)
    expect(result).toBe(input)
  })

  it("should truncate at sentence boundary", () => {
    const input = "First sentence. Second sentence. Third very long sentence that goes on."
    const result = truncateText(input, 30)
    expect(result).toContain("Second sentence.")
    expect(result).not.toContain("Third")
  })

  it("should truncate at word boundary if no sentence", () => {
    const input = "Word1 Word2 Word3 Word4 Word5"
    const result = truncateText(input, 20)
    expect(result).toContain("...")
    expect(result.length).toBeLessThanOrEqual(23) // 20 + "..."
  })

  it("should handle empty string", () => {
    const input = ""
    const result = truncateText(input, 100)
    expect(result).toBe("")
  })
})

describe("validateTTSText", () => {
  it("should validate empty text", () => {
    const result = validateTTSText("")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Text is empty")
  })

  it("should validate text that is too long", () => {
    const result = validateTTSText("x".repeat(10001))
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Text is too long for TTS")
  })

  it("should detect unprocessed code blocks", () => {
    const result = validateTTSText("Text with ```code```")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Contains unprocessed code blocks")
  })

  it("should detect unprocessed URLs", () => {
    const result = validateTTSText("Visit https://example.com")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Contains unprocessed URLs")
  })

  it("should validate valid text", () => {
    const result = validateTTSText("This is valid TTS text.")
    expect(result.isValid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })
})

describe("preprocessTextForTTS - Integration", () => {
  it("should process full text for TTS", () => {
    const input = `**Bold** thinking content. More text.`
    const result = preprocessTextForTTS(input)
    expect(result).not.toContain("**")
    expect(result).not.toContain("thinking content")
  })

  it("should handle all options disabled", () => {
    const input = "```code``` and https://url"
    const result = preprocessTextForTTS(input, {
      removeThinkingBlocks: false,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false,
    })
    expect(result).toContain("```code```")
    expect(result).toContain("https://")
  })

  it("should process with all options enabled", () => {
    const input = `**Heading**
\`\`\`js
const x = 1;
\`\`\`
Visit https://example.com`
    const result = preprocessTextForTTS(input)
    expect(result).not.toContain("**")
    expect(result).toContain("[code block]")
    expect(result).toContain("[web link]")
  })

  it("should preserve TTS placeholders through full processing", () => {
    const input = "Code: ```js const x = 1;``` Link: https://test.com"
    const result = preprocessTextForTTS(input)
    expect(result).toContain("[code block]")
    expect(result).toContain("[web link]")
  })
})

describe("convertCurrency", () => {
  it("should strip USD symbol with comma-separated amount", () => {
    // Regex strips symbol, returns number with commas preserved
    expect(convertCurrency("$1,234.56")).toBe(" 1,234.56")
  })

  it("should strip USD symbol without cents", () => {
    expect(convertCurrency("$500")).toBe(" 500")
  })

  it("should strip EUR symbol", () => {
    expect(convertCurrency("€500")).toBe(" 500")
    expect(convertCurrency("€1,234.56")).toBe(" 1,234.56")
  })

  it("should strip GBP symbol", () => {
    expect(convertCurrency("£50.99")).toBe(" 50.99")
  })

  it("should strip JPY symbol", () => {
    expect(convertCurrency("¥1000")).toBe(" 1000")
    expect(convertCurrency("¥1000 yen")).toBe(" 1000 yen")
  })

  it("should handle explicit currency words", () => {
    expect(convertCurrency("50.99 USD")).toBe("50 dollars 99 cents USD")
    expect(convertCurrency("100 EUR")).toBe("100 EUR")
    expect(convertCurrency("75.50 GBP")).toBe("75 pounds 50 pence GBP")
  })

  it("should handle multiple currencies in one string", () => {
    const input = "Price is $50.00 plus €25.00"
    const result = convertCurrency(input)
    expect(result).toContain(" 50.00")
    expect(result).toContain(" 25.00")
  })

  it("should handle currency without space after symbol", () => {
    expect(convertCurrency("$50")).toBe(" 50")
    expect(convertCurrency("€100")).toBe(" 100")
  })

  // Bug fix: currency regex now handles amounts without comma separators
  it("should strip USD with cents but no comma separators", () => {
    // This was the bug: $1234.56 failed because regex required \d{1,3} at start
    expect(convertCurrency("$1234.56")).toBe(" 1234.56")
  })

  it("should strip USD without cents and no comma separators", () => {
    expect(convertCurrency("$1234")).toBe(" 1234")
    expect(convertCurrency("$999")).toBe(" 999")
  })

  it("should strip small amounts without comma separators", () => {
    expect(convertCurrency("$1.99")).toBe(" 1.99")
    expect(convertCurrency("$0.50")).toBe(" 0.50")
  })
})
