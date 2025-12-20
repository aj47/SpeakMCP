export function parseShellCommand(commandString: string): { command: string; args: string[] } {
  const trimmed = commandString.trim()
  if (!trimmed) {
    return { command: "", args: [] }
  }

  const parts: string[] = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]

    if (escaped) {
      if (char === '"' || char === "\\") {
        current += char
      } else {
        current += "\\" + char
      }
      escaped = false
      continue
    }

    if (char === "\\" && inDoubleQuote) {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        parts.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (current) {
    parts.push(current)
  }

  if (parts.length === 0) {
    return { command: "", args: [] }
  }

  return {
    command: parts[0],
    args: parts.slice(1),
  }
}

