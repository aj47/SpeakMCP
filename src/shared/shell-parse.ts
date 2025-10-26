/**
 * Parse a shell-like command string into command and arguments.
 * Handles quoted strings (both single and double quotes) and preserves spaces within quotes.
 * 
 * Examples:
 * - `npx -y @modelcontextprotocol/server-google-maps` -> ["npx", "-y", "@modelcontextprotocol/server-google-maps"]
 * - `"C:\Program Files\My Server\run.bat" --arg value` -> ["C:\Program Files\My Server\run.bat", "--arg", "value"]
 * - `node "path with spaces/script.js" arg1 arg2` -> ["node", "path with spaces/script.js", "arg1", "arg2"]
 * 
 * @param commandString - The full command string to parse
 * @returns Object with command (first part) and args (remaining parts)
 */
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

    // Handle escape sequences (only in double quotes for specific characters)
    if (escaped) {
      // In double quotes, only " and \ are escape characters
      if (char === '"' || char === "\\") {
        current += char
      } else {
        // Not an escape sequence, keep the backslash
        current += "\\" + char
      }
      escaped = false
      continue
    }

    if (char === "\\" && inDoubleQuote) {
      escaped = true
      continue
    }

    // Handle quotes
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    // Handle spaces (word boundaries)
    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        parts.push(current)
        current = ""
      }
      continue
    }

    // Regular character
    current += char
  }

  // Add the last part if any
  if (current) {
    parts.push(current)
  }

  // Return command and args
  if (parts.length === 0) {
    return { command: "", args: [] }
  }

  return {
    command: parts[0],
    args: parts.slice(1),
  }
}

