export type FrontmatterDocument = {
  frontmatter: Record<string, string>
  body: string
}

const FRONTMATTER_REGEX = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/

/**
 * Parse simple frontmatter using `key: value` lines (no full YAML support).
 */
export function parseFrontmatterDocument(markdown: string): FrontmatterDocument | null {
  const match = markdown.match(FRONTMATTER_REGEX)
  if (!match) return null

  const rawFrontmatter = match[1]
  const body = (match[2] ?? "").trim()
  const frontmatter: Record<string, string> = {}

  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf(":")
    if (idx <= 0) continue

    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()

    // Unquote common cases
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }

    frontmatter[key] = value
  }

  return { frontmatter, body }
}

export function parseFrontmatterOrBody(markdown: string): FrontmatterDocument {
  return parseFrontmatterDocument(markdown) ?? { frontmatter: {}, body: markdown.trim() }
}

export function stringifyFrontmatterDocument(doc: FrontmatterDocument): string {
  const lines = Object.entries(doc.frontmatter)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
  const body = doc.body.trim()
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`
}
