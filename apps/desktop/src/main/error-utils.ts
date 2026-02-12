import { MCPToolResult } from "./mcp-service"

/**
 * Clean error message by removing stack traces and noise
 */
export function cleanErrorMessage(errorText: string): string {
  // Remove stack traces (lines starting with "at " after an error)
  const lines = errorText.split('\n')
  const cleanedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip stack trace lines
    if (trimmed.startsWith('at ')) continue
    // Skip file path lines
    if (trimmed.match(/^\s*at\s+.*\.(js|ts|mjs):\d+/)) continue
    // Skip empty lines in stack traces
    if (cleanedLines.length > 0 && trimmed === '' && lines.indexOf(line) > 0) {
      const prevLine = lines[lines.indexOf(line) - 1]?.trim()
      if (prevLine?.startsWith('at ')) continue
    }
    cleanedLines.push(line)
  }

  let cleaned = cleanedLines.join('\n').trim()

  // Remove duplicate error class names (e.g., "CodeExecutionTimeoutError: Code execution timed out")
  cleaned = cleaned.replace(/(\w+Error):\s*\1:/g, '$1:')

  // Truncate if still too long
  if (cleaned.length > 500) {
    cleaned = cleaned.substring(0, 500) + '...'
  }

  return cleaned
}

/**
 * Analyze tool errors and categorize them
 */
export function analyzeToolErrors(toolResults: MCPToolResult[]): {
  errorTypes: string[]
} {
  const errorTypes: string[] = []
  const errorMessages = toolResults
    .filter((r) => r.isError)
    .map((r) => r.content.map((c) => c.text).join(" ").toLowerCase())
    .join(" ")

  // Categorize error types
  if (errorMessages.includes("timeout") || errorMessages.includes("timed out")) {
    errorTypes.push("timeout")
  }
  if (errorMessages.includes("connection") || errorMessages.includes("network")) {
    errorTypes.push("connectivity")
  }
  if (errorMessages.includes("permission") || errorMessages.includes("access") || errorMessages.includes("denied")) {
    errorTypes.push("permissions")
  }
  if (errorMessages.includes("not found") || errorMessages.includes("does not exist") || errorMessages.includes("missing")) {
    errorTypes.push("not_found")
  }
  if (errorMessages.includes("invalid") || errorMessages.includes("expected")) {
    errorTypes.push("invalid_params")
  }

  return { errorTypes }
}
