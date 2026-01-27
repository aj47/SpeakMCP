/**
 * Debug utilities for SpeakMCP Server
 * Simplified version of desktop's debug.ts
 */

export interface DebugFlags {
  llm: boolean
  tools: boolean
  mcp: boolean
  server: boolean
  all: boolean
}

const flags: DebugFlags = {
  llm: false,
  tools: false,
  mcp: false,
  server: false,
  all: false,
}

function strToBool(v: string | undefined): boolean {
  if (!v) return false
  const s = v.toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

export function initDebugFlags(argv: string[] = process.argv): DebugFlags {
  const has = (name: string) => argv.includes(name)
  const hasAny = (...names: string[]) => names.some(name => argv.includes(name))

  const envDebug = (process.env.DEBUG || "").toLowerCase()
  const envParts = envDebug.split(/[,:\s]+/).filter(Boolean)

  const envLLM =
    strToBool(process.env.DEBUG_LLM) ||
    envParts.includes("llm") ||
    envDebug === "*" ||
    envDebug.includes("all")
  const envTools =
    strToBool(process.env.DEBUG_TOOLS) ||
    envParts.includes("tools") ||
    envDebug === "*" ||
    envDebug.includes("all")
  const envMCP =
    strToBool(process.env.DEBUG_MCP) ||
    envParts.includes("mcp") ||
    envDebug === "*" ||
    envDebug.includes("all")
  const envServer =
    strToBool(process.env.DEBUG_SERVER) ||
    envParts.includes("server") ||
    envDebug === "*" ||
    envDebug.includes("all")

  const all =
    hasAny("--debug", "--debug-all", "-d", "-da", "debug", "debug-all", "d", "da") ||
    envDebug === "*" ||
    envParts.includes("all")

  flags.llm = all || hasAny("--debug-llm", "-dl", "debug-llm", "dl") || envLLM
  flags.tools = all || hasAny("--debug-tools", "-dt", "debug-tools", "dt") || envTools
  flags.mcp = all || hasAny("--debug-mcp", "-dmcp", "debug-mcp", "dmcp") || envMCP
  flags.server = all || hasAny("--debug-server", "-ds", "debug-server", "ds") || envServer
  flags.all = all

  if (flags.llm || flags.tools || flags.mcp || flags.server) {
    const enabled: string[] = []
    if (flags.llm) enabled.push("LLM")
    if (flags.tools) enabled.push("TOOLS")
    if (flags.mcp) enabled.push("MCP")
    if (flags.server) enabled.push("SERVER")
    console.log(`[DEBUG] Enabled: ${enabled.join(", ")}`)
  }

  return { ...flags }
}

export function isDebugLLM(): boolean {
  return flags.llm || flags.all
}

export function isDebugTools(): boolean {
  return flags.tools || flags.all
}

export function isDebugMCP(): boolean {
  return flags.mcp || flags.all
}

export function isDebugServer(): boolean {
  return flags.server || flags.all
}

function ts(): string {
  const d = new Date()
  return d.toISOString()
}

export function logLLM(...args: unknown[]): void {
  if (!isDebugLLM()) return
  console.log(`[${ts()}] [DEBUG][LLM]`, ...args)
}

export function logTools(...args: unknown[]): void {
  if (!isDebugTools()) return
  console.log(`[${ts()}] [DEBUG][TOOLS]`, ...args)
}

export function logMCP(direction: "REQUEST" | "RESPONSE", serverName: string, data: unknown): void {
  if (!isDebugMCP()) return
  const prefix = direction === "REQUEST" ? "→" : "←"
  const formatted = typeof data === "object" && data !== null
    ? JSON.stringify(data, null, 2)
    : String(data)
  console.log(`[${ts()}] [MCP] ${prefix} [${serverName}]\n${formatted}`)
}

export function logServer(...args: unknown[]): void {
  if (!isDebugServer()) return
  console.log(`[${ts()}] [DEBUG][SERVER]`, ...args)
}

export function getDebugFlags(): DebugFlags {
  return { ...flags }
}

