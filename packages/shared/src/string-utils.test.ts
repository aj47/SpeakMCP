/**
 * String Utilities Tests
 * 
 * Tests for the shared string-utils module used by SpeakMCP
 * for text truncation, counting, and markdown stripping.
 */

import { describe, it, expect } from "vitest"
import {
  truncateAtBoundary,
  wordCount,
  stripMarkdown,
  exceedsMaxLength,
  extractSummary,
} from "./string-utils"

describe("truncateAtBoundary", () => {
  it("should return original text if under max length", () => {
    const input = "Short text"
    const result = truncateAtBoundary(input, 100)
    expect(result).toBe(input)
  })

  it("should truncate at sentence boundary", () => {
    const input = "First sentence. Second sentence. Third very long sentence that goes on."
    const result = truncateAtBoundary(input, 40)
    expect(result).toContain("Second")
    expect(result).not.toContain("Third")
  })

  it("should handle multiple sentence endings", () => {
    const input = "Hello! How are you? I'm doing well."
    const result = truncateAtBoundary(input, 20)
    expect(result).toContain("How")
  })

  it("should truncate at word boundary if no complete sentence fits", () => {
    const input = "Word1 Word2 Word3 Word4 Word5"
    const result = truncateAtBoundary(input, 20)
    expect(result).toContain("...")
    expect(result.length).toBeLessThanOrEqual(23) // 20 + "..."
  })

  it("should handle empty string", () => {
    const input = ""
    const result = truncateAtBoundary(input, 100)
    expect(result).toBe("")
  })

  it("should handle newlines in text", () => {
    const input = "First sentence.\nSecond sentence.\nThird sentence."
    const result = truncateAtBoundary(input, 35)
    expect(result).toContain("Second")
  })

  it("should handle texts with no punctuation", () => {
    const input = "This is a long text without any punctuation marks"
    const result = truncateAtBoundary(input, 20)
    expect(result).toContain("...")
  })
})

describe("wordCount", () => {
  it("should count single word", () => {
    const input = "Hello"
    const result = wordCount(input)
    expect(result).toBe(1)
  })

  it("should count multiple words", () => {
    const input = "Hello world from tests"
    const result = wordCount(input)
    expect(result).toBe(4)
  })

  it("should handle multiple spaces", () => {
    const input = "Hello    world"
    const result = wordCount(input)
    expect(result).toBe(2)
  })

  it("should handle leading and trailing whitespace", () => {
    const input = "  Hello world  "
    const result = wordCount(input)
    expect(result).toBe(2)
  })

  it("should return 0 for empty string", () => {
    const input = ""
    const result = wordCount(input)
    expect(result).toBe(0)
  })

  it("should return 0 for whitespace only", () => {
    const input = "   \n\t  "
    const result = wordCount(input)
    expect(result).toBe(0)
  })

  it("should handle tabs and newlines as separators", () => {
    const input = "Hello\tworld\nfrom\ttests"
    const result = wordCount(input)
    expect(result).toBe(4)
  })
})

describe("stripMarkdown", () => {
  it("should remove bold formatting", () => {
    const input = "**bold text**"
    const result = stripMarkdown(input)
    expect(result).toBe("bold text")
    expect(result).not.toContain("**")
  })

  it("should remove italic formatting", () => {
    const input = "*italic text*"
    const result = stripMarkdown(input)
    expect(result).toBe("italic text")
    expect(result).not.toContain("*")
  })

  it("should remove both bold and italic", () => {
    const input = "**bold** and *italic*"
    const result = stripMarkdown(input)
    expect(result).toBe("bold and italic")
  })

  it("should remove code blocks", () => {
    const input = "```js\nconst x = 1;\n```"
    const result = stripMarkdown(input)
    expect(result).not.toContain("```")
    expect(result).not.toContain("const")
  })

  it("should remove inline code", () => {
    const input = "Use `console.log()` to debug."
    const result = stripMarkdown(input)
    expect(result).toContain("console.log()")
    expect(result).not.toContain("`")
  })

  it("should remove headings", () => {
    const input = "# Heading 1\n## Heading 2\n### Heading 3"
    const result = stripMarkdown(input)
    expect(result).not.toContain("#")
    expect(result).toContain("Heading 1")
  })

  it("should extract link text", () => {
    const input = "[link text](https://example.com)"
    const result = stripMarkdown(input)
    expect(result).toContain("link text")
    expect(result).not.toContain("(")
  })

  it("should remove images", () => {
    const input = "![alt text](image.png)"
    const result = stripMarkdown(input)
    // The image alt text gets extracted
    expect(result).not.toContain("(")
    expect(result).not.toContain(")")
    expect(result).not.toContain("[")
    expect(result).not.toContain("]")
  })

  it("should remove strikethrough", () => {
    const input = "~~deleted text~~"
    const result = stripMarkdown(input)
    expect(result).toBe("deleted text")
    expect(result).not.toContain("~~")
  })

  it("should remove unordered lists", () => {
    const input = "- Item 1\n- Item 2\n- Item 3"
    const result = stripMarkdown(input)
    expect(result).not.toContain("-")
    expect(result).toContain("Item 1")
  })

  it("should remove ordered lists", () => {
    const input = "1. First item\n2. Second item"
    const result = stripMarkdown(input)
    expect(result).not.toContain("1.")
    expect(result).not.toContain("2.")
    expect(result).toContain("First item")
  })

  it("should remove blockquotes", () => {
    const input = "> This is a quote"
    const result = stripMarkdown(input)
    expect(result).not.toContain(">")
    expect(result).toContain("quote")
  })

  it("should remove horizontal rules", () => {
    const input = "Text\n---\nMore text"
    const result = stripMarkdown(input)
    expect(result).not.toContain("---")
    expect(result).toContain("Text")
  })

  it("should handle mixed markdown", () => {
    const input = `# Title

**bold** and *italic*

- List item 1
- List item 2

[Link](http://example.com)

\`\`\`code\`\`\`

More text.`
    const result = stripMarkdown(input)
    expect(result).not.toContain("#")
    expect(result).not.toContain("**")
    expect(result).not.toContain("*")
    expect(result).not.toContain("-")
    expect(result).not.toContain("[")
    expect(result).not.toContain("```")
    expect(result).toContain("Title")
    expect(result).toContain("bold")
    expect(result).toContain("italic")
    expect(result).toContain("Link")
  })

  it("should handle empty string", () => {
    const input = ""
    const result = stripMarkdown(input)
    expect(result).toBe("")
  })
})

describe("exceedsMaxLength", () => {
  it("should return false for text under limit", () => {
    const result = exceedsMaxLength("Short text", 100)
    expect(result).toBe(false)
  })

  it("should return true for text over limit", () => {
    const result = exceedsMaxLength("This is a long text", 10)
    expect(result).toBe(true)
  })

  it("should return false for exact limit", () => {
    const result = exceedsMaxLength("Exact", 5)
    expect(result).toBe(false)
  })

  it("should return false for empty string", () => {
    const result = exceedsMaxLength("", 10)
    expect(result).toBe(false)
  })

  it("should handle zero maxLength", () => {
    const result = exceedsMaxLength("Text", 0)
    expect(result).toBe(true)
  })
})

describe("extractSummary", () => {
  it("should return full text if under max length", () => {
    const input = "Short text."
    const result = extractSummary(input, 100)
    expect(result.text).toBe(input)
    expect(result.truncated).toBe(false)
  })

  it("should extract by sentences", () => {
    const input = "First sentence. Second sentence. Third sentence."
    const result = extractSummary(input, 40, 'sentences')
    expect(result.text).toContain("First sentence.")
    expect(result.text).toContain("Second sentence.")
    expect(result.truncated).toBe(true)
  })

  it("should extract by words", () => {
    const input = "Word1 Word2 Word3 Word4 Word5"
    const result = extractSummary(input, 20, 'words')
    expect(result.mode).toBe('words')
    expect(result.truncated).toBe(true)
    expect(result.text.split(/\s+/).length).toBeLessThanOrEqual(4)
  })

  it("should handle empty string", () => {
    const result = extractSummary("", 100)
    expect(result.text).toBe("")
    expect(result.truncated).toBe(false)
  })

  it("should handle sentences with different punctuation", () => {
    const input = "Hello! How are you? I'm doing well."
    const result = extractSummary(input, 15, 'sentences')
    expect(result.text).toBe("Hello!")
  })

  it("should return empty result for zero maxLength", () => {
    const input = "Some text"
    const result = extractSummary(input, 0)
    expect(result.text).toBe("")
  })
})

describe("Integration - String Utils Pipeline", () => {
  it("should strip markdown then truncate", () => {
    const input = "## Title\n\n**Bold** *italic* text here. More content."
    const stripped = stripMarkdown(input)
    const truncated = truncateAtBoundary(stripped, 30)
    expect(truncated).not.toContain("#")
    expect(truncated).not.toContain("**")
    expect(truncated).not.toContain("*")
    expect(truncated.length).toBeLessThanOrEqual(33)
  })

  it("should validate length after stripping markdown", () => {
    const input = "**Bold** text here."
    // "Bold text here." is 16 chars, so it exceeds 10
    expect(exceedsMaxLength(stripMarkdown(input), 10)).toBe(true)
    // But "Bold" is only 5 chars
    expect(exceedsMaxLength(stripMarkdown(input), 16)).toBe(false)
  })

  it("should count words after stripping markdown", () => {
    const input = "# Heading\n- Item 1\n- Item 2\n- Item 3"
    const count = wordCount(stripMarkdown(input))
    // After stripping: "Heading Item 1 Item 2 Item 3" = 7 words (1 Heading + 4 items)
    expect(count).toBe(7)
  })
})
