import { describe, it, expect } from "vitest"
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter"

describe("frontmatter", () => {
  it("parses simple key:value frontmatter", () => {
    const md = `---
name: Test
description: hello world
enabled: true
---

Body text\nLine 2\n`

    const doc = parseFrontmatterDocument(md)
    expect(doc).not.toBeNull()
    expect(doc!.frontmatter).toEqual({
      name: "Test",
      description: "hello world",
      enabled: "true",
    })
    expect(doc!.body).toBe("Body text\nLine 2")
  })

  it("handles CRLF line endings", () => {
    const md = "---\r\nname: X\r\n---\r\nHello\r\n"
    const doc = parseFrontmatterDocument(md)
    expect(doc?.frontmatter.name).toBe("X")
    expect(doc?.body).toBe("Hello")
  })

  it("stringifies deterministically (sorted keys)", () => {
    const out = stringifyFrontmatterDocument({
      frontmatter: { b: "2", a: "1" },
      body: "hi",
    })
    expect(out).toBe("---\na: 1\nb: 2\n---\n\nhi\n")
  })
})
