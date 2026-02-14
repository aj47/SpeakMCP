/**
 * Tests for tts-preprocessing utilities
 */
import { describe, it, expect } from "vitest"
import {
  removeThinkingBlocks,
  removeCodeBlocks,
  convertMarkdownToSpeech,
  cleanSymbols,
  convertCurrency,
  convertNumbers,
  normalizeWhitespace,
  truncateText,
  validateTTSText,
} from "./tts-preprocessing"

describe("removeThinkingBlocks", () => {
  it("removes single-line thinking blocks", () => {
    const input = "Hello <thinking>ignore this</thinking> world"
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("removes multiline thinking blocks", () => {
    const input = `Hello <thinking>
      This is a long
      thinking block
    </thinking> world`
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("removes thinking blocks case-insensitively", () => {
    const input = "Hello <THINKING>ignore this</THINKING> world"
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("removes think blocks", () => {
    const input = "Hello <function_call>ignore this</think> world"
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("removes xml-style think blocks", () => {
    const input = "Hello <think>ignore this</think> world"
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("removes mixed thinking block formats", () => {
    const input = "<thinking>first</thinking> and <think>second</think> world"
    expect(removeThinkingBlocks(input)).toBe(" and  world")
  })

  it("removes empty thinking blocks", () => {
    const input = "Hello <thinking></thinking> world"
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("handles text with no thinking blocks", () => {
    const input = "Hello world"
    expect(removeThinkingBlocks(input)).toBe("Hello world")
  })

  it("removes nested thinking blocks", () => {
    const input = "<thinking>outer <thinking>inner</thinking> outer</thinking>"
    expect(removeThinkingBlocks(input)).toBe("")
  })
})

describe("removeCodeBlocks", () => {
  it("removes fenced code blocks", () => {
    const input = "```const x = 1;```"
    expect(removeCodeBlocks(input)).toBe(" [code block] ")
  })

  it("removes inline code", () => {
    const input = "Use `console.log()` for debugging"
    expect(removeCodeBlocks(input)).toBe("Use  console.log()  for debugging")
  })

  it("removes HTML tags", () => {
    const input = "<div>content</div>"
    expect(removeCodeBlocks(input)).toBe(" content ")
  })
})

describe("convertMarkdownToSpeech", () => {
  it("converts headings", () => {
    expect(convertMarkdownToSpeech("# Title")).toBe("Heading: Title.")
    expect(convertMarkdownToSpeech("## Subtitle")).toBe("Heading: Subtitle.")
  })

  it("removes bold formatting", () => {
    expect(convertMarkdownToSpeech("**bold**")).toBe("bold")
  })

  it("removes italic formatting", () => {
    expect(convertMarkdownToSpeech("*italic*")).toBe("italic")
  })

  it("converts lists to items", () => {
    expect(convertMarkdownToSpeech("- item")).toBe("Item: item.")
    expect(convertMarkdownToSpeech("1. item")).toBe("Item: item.")
  })
})

describe("cleanSymbols", () => {
  it("replaces common symbols", () => {
    expect(cleanSymbols("a && b")).toBe("a  and  b")
    expect(cleanSymbols("a || b")).toBe("a  or  b")
    expect(cleanSymbols("a => b")).toBe("a  arrow  b")
  })

  it("converts at symbol for speech", () => {
    expect(cleanSymbols("email@example.com")).toBe("email at example.com")
  })

  it("preserves TTS placeholders", () => {
    expect(cleanSymbols("[code block]")).toBe("[code block]")
  })
})

describe("convertCurrency", () => {
  it("converts USD", () => {
    expect(convertCurrency("$50")).toBe("50 dollars")
    expect(convertCurrency("$50.25")).toBe("50 dollars 25 cents")
  })

  it("converts EUR", () => {
    expect(convertCurrency("€50")).toBe("50 euros")
    expect(convertCurrency("€50.25")).toBe("50 euros 25 cents")
  })

  it("converts GBP", () => {
    expect(convertCurrency("£50")).toBe("50 pounds")
    expect(convertCurrency("£50.99")).toBe("50 pounds 99 pence")
  })

  it("converts JPY", () => {
    expect(convertCurrency("¥1000")).toBe("1000 yen")
  })

  it("handles currency codes", () => {
    expect(convertCurrency("50 USD")).toBe("50 dollars")
    expect(convertCurrency("50.99 EUR")).toBe("50 euros 99 cents")
  })
})

describe("convertNumbers", () => {
  it("converts version numbers", () => {
    expect(convertNumbers("v1.2.3")).toBe("version 1 point 2 point 3")
  })

  it("handles phone numbers", () => {
    expect(convertNumbers("(123) 456-7890")).toBe("123 456 7890")
  })

  it("handles percentages", () => {
    expect(convertNumbers("50%")).toBe("50 percent")
    expect(convertNumbers("12.5%")).toBe("12 point 5 percent")
  })

  it("removes commas from numbers", () => {
    expect(convertNumbers("1,234,567")).toBe("1 234 567")
  })
})

describe("normalizeWhitespace", () => {
  it("normalizes whitespace", () => {
    expect(normalizeWhitespace("Hello    world")).toBe("Hello world.")
  })

  it("adds trailing period", () => {
    expect(normalizeWhitespace("Hello world")).toBe("Hello world.")
  })
})

describe("truncateText", () => {
  it("truncates long text", () => {
    const long = "A".repeat(200)
    expect(truncateText(long, 100).length).toBeLessThan(110)
  })

  it("doesn't truncate short text", () => {
    expect(truncateText("Hello", 100)).toBe("Hello")
  })
})

describe("validateTTSText", () => {
  it("validates empty text", () => {
    const result = validateTTSText("")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Text is empty")
  })

  it("validates text with URLs", () => {
    const result = validateTTSText("Check https://example.com")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Contains unprocessed URLs")
  })

  it("validates text with code blocks", () => {
    const result = validateTTSText("```code```")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Contains unprocessed code blocks")
  })
})
