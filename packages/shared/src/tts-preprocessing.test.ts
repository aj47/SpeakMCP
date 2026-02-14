import { describe, expect, it } from "vitest"
import {
  preprocessForTTS,
  removeThinkingBlocks,
  removeCodeBlocks,
  removeUrls,
  convertMarkdownToSpeech,
  cleanSymbols,
  convertNumbers,
  normalizeWhitespace,
  truncateText,
  validateTTSText,
} from "./tts-preprocessing"

describe("preprocessForTTS", () => {
  it("processes basic text for speech", () => {
    const result = preprocessForTTS("Hello **world**!")
    expect(result).toContain("Hello world")
  })

  it("removes code blocks", () => {
    const input = "Here is code: ```const x = 1``` end"
    const result = preprocessForTTS(input)
    expect(result).toContain("[code block]")
    expect(result).not.toContain("const x = 1")
  })

  it("converts markdown links to text", () => {
    const input = "Click [here](https://example.com) please"
    const result = preprocessForTTS(input)
    expect(result).toContain("here")
    expect(result).not.toContain("https://example.com")
  })

  it("removes thinking blocks", () => {
    const input = "Hello<think> This is hidden</think>world"
    const result = preprocessForTTS(input)
    expect(result).not.toContain("This is hidden")
  })
})

describe("removeThinkingBlocks", () => {
  it("removes thinking blocks", () => {
    const input = "Hello <think>hidden</think> world"
    expect(removeThinkingBlocks(input)).toBe("Hello  world")
  })

  it("removes multiline thinking blocks", () => {
    const input = `Start
<think>
Line 1
Line 2
</think>
End`
    expect(removeThinkingBlocks(input)).toBe("Start\n\nEnd")
  })

  it("handles empty string", () => {
    expect(removeThinkingBlocks("")).toBe("")
  })
})

describe("removeCodeBlocks", () => {
  it("replaces code blocks with placeholder", () => {
    const input = "```const x = 1```"
    expect(removeCodeBlocks(input)).toBe(" [code block] ")
  })

  it("replaces inline code with text", () => {
    const input = "Use `console.log()` please"
    expect(removeCodeBlocks(input)).toBe(" Use  console.log()  please")
  })

  it("removes HTML tags", () => {
    const input = "<div>Hello</div>"
    expect(removeCodeBlocks(input)).toBe(" Hello ")
  })
})

describe("removeUrls", () => {
  it("removes HTTP URLs", () => {
    const input = "Visit https://example.com today"
    expect(removeUrls(input)).toBe(" Visit  [web link]  today")
  })

  it("removes email addresses", () => {
    const input = "Contact test@example.com"
    expect(removeUrls(input)).toContain("[email address]")
  })
})

describe("convertMarkdownToSpeech", () => {
  it("converts headers to spoken format", () => {
    const input = "# Main Title"
    expect(convertMarkdownToSpeech(input)).toContain("Heading: Main Title")
  })

  it("removes bold and italic markers", () => {
    const input = "**bold** and *italic*"
    expect(convertMarkdownToSpeech(input)).toContain("bold and italic")
  })

  it("converts lists to spoken format", () => {
    const input = "- First item"
    expect(convertMarkdownToSpeech(input)).toContain("Item: First item")
  })

  it("handles numbered lists", () => {
    const input = "1. First item"
    expect(convertMarkdownToSpeech(input)).toContain("Item: First item")
  })
})

describe("cleanSymbols", () => {
  it("replaces common symbols", () => {
    const input = "x && y || z"
    expect(cleanSymbols(input)).toContain("x  and  y  or  z")
  })

  it("replaces @ symbol", () => {
    const input = "Email me @user"
    expect(cleanSymbols(input)).toContain("Email me  at user")
  })

  it("reduces multiple exclamation marks", () => {
    const input = "Wow!! Really??"
    expect(cleanSymbols(input)).toContain("Wow! Really?")
  })

  it("removes parentheses but not placeholders", () => {
    const input = "Hello (world) and [code block]"
    const result = cleanSymbols(input)
    expect(result).toContain("[code block]")
    expect(result).not.toContain("(world)")
  })
})

describe("convertNumbers", () => {
  it("converts version numbers", () => {
    expect(convertNumbers("v1.2.3")).toContain("version 1 point 2 point 3")
  })

  it("removes commas from numbers", () => {
    const input = "1,234,567"
    expect(convertNumbers(input)).toBe("1234567")
  })

  it("handles decimal numbers", () => {
    const input = "3.14159"
    expect(convertNumbers(input)).toContain("3 point 14159")
  })
})

describe("normalizeWhitespace", () => {
  it("normalizes multiple spaces", () => {
    const input = "Hello    world"
    expect(normalizeWhitespace(input)).toBe("Hello world.")
  })

  it("removes leading/trailing whitespace", () => {
    const input = "  Hello  "
    expect(normalizeWhitespace(input)).toBe("Hello.")
  })

  it("adds period if missing", () => {
    const input = "Hello world"
    expect(normalizeWhitespace(input)).toBe("Hello world.")
  })
})

describe("truncateText", () => {
  it("returns original if under max length", () => {
    const input = "Short text"
    expect(truncateText(input, 100)).toBe(input)
  })

  it("truncates at sentence boundary when possible", () => {
    const input = "First sentence. Second sentence is much longer and exceeds the limit."
    const result = truncateText(input, 30)
    expect(result).toContain("First sentence.")
    expect(result.length).toBeLessThanOrEqual(33)
  })

  it("falls back to word boundary", () => {
    const input = "This is a very long sentence without any punctuation near the end that needs truncation"
    const result = truncateText(input, 30)
    expect(result.length).toBeLessThanOrEqual(33)
  })

  it("adds ellipsis when truncating", () => {
    const input = "This is a very long sentence without proper ending"
    const result = truncateText(input, 20)
    expect(result).toContain("...")
  })
})

describe("validateTTSText", () => {
  it("validates empty text", () => {
    const result = validateTTSText("")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Text is empty")
  })

  it("rejects text with remaining code blocks", () => {
    const result = validateTTSText("Hello ```code```")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Contains unprocessed code blocks")
  })

  it("rejects text with remaining URLs", () => {
    const result = validateTTSText("Visit https://example.com")
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain("Contains unprocessed URLs")
  })

  it("accepts valid preprocessed text", () => {
    const result = validateTTSText("Hello world. This is good for TTS.")
    expect(result.isValid).toBe(true)
    expect(result.issues.length).toBe(0)
  })
})
