export interface DebugFlags {
  llm: boolean
  tools: boolean
  keybinds: boolean
  app: boolean
  ui: boolean
  mcp: boolean
  acp: boolean
  all: boolean
  printQr: boolean
  headless: boolean
}

const flags: DebugFlags = {
  llm: false,
  tools: false,
  keybinds: false,
  app: false,
  ui: false,
  mcp: false,
  acp: false,
  all: false,
  printQr: false,
  headless: false,
}

function strToBool(v: string | undefined): boolean {
  if (!v) return false
  const s = v.toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

export function initDebugFlags(argv: string[] = process.argv): DebugFlags {
  // CLI flags - support both long and short forms, with and without dashes.
  // When launched via `pnpm dev -- --qr`, Electron's process.argv looks like:
  //   ["<electron>", ".", "--", "--qr"]
  // The "--qr" string is present verbatim after the "--" separator.
  const has = (name: string) => argv.includes(name)
  const hasAny = (...names: string[]) => names.some(name => argv.includes(name))

  // Safe accessor for app.commandLine as an additional fallback
  let appHasSwitch: (sw: string) => boolean = () => false
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require("electron") as typeof import("electron")
    if (app?.commandLine?.hasSwitch) {
      appHasSwitch = (sw: string) => app.commandLine.hasSwitch(sw)
    }
  } catch {
    // Not in Electron context (e.g. unit tests) — ignore
  }

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
  const envKeybinds =
    strToBool(process.env.DEBUG_KEYBINDS) ||
    envParts.includes("keybinds") ||
    envDebug === "*" ||
    envDebug.includes("all")

  const envApp =
    strToBool(process.env.DEBUG_APP) ||
    envParts.includes("app") ||
    envDebug === "*" ||
    envDebug.includes("all")

  const envUI =
    strToBool(process.env.DEBUG_UI) ||
    envParts.includes("ui") ||
    envDebug === "*" ||
    envDebug.includes("all")

  const envMCP =
    strToBool(process.env.DEBUG_MCP) ||
    envParts.includes("mcp") ||
    envDebug === "*" ||
    envDebug.includes("all")

  const envACP =
    strToBool(process.env.DEBUG_ACP) ||
    envParts.includes("acp") ||
    envDebug === "*" ||
    envDebug.includes("all")

  const all =
    hasAny("--debug", "--debug-all", "-d", "-da", "debug", "debug-all", "d", "da") ||
    envDebug === "*" ||
    envParts.includes("all")

  flags.llm = all || hasAny("--debug-llm", "-dl", "debug-llm", "dl") || envLLM
  flags.tools = all || hasAny("--debug-tools", "-dt", "debug-tools", "dt") || envTools
  flags.keybinds = all || hasAny("--debug-keybinds", "-dk", "debug-keybinds", "dk") || envKeybinds
  flags.app = all || hasAny("--debug-app", "-dapp", "debug-app", "dapp") || envApp
  flags.ui = all || hasAny("--debug-ui", "-dui", "debug-ui", "dui") || envUI
  flags.mcp = all || hasAny("--debug-mcp", "-dmcp", "debug-mcp", "dmcp") || envMCP
  flags.acp = all || hasAny("--debug-acp", "-dacp", "debug-acp", "dacp") || envACP
  flags.all = all
  // Note: in Electron, process.argv contains ["...", ".", "--", "--qr"] when launched with --qr
  // The "--qr" string is present verbatim (the "--" separator is also in argv).
  // Also check app.commandLine.hasSwitch as a fallback for edge cases.
  flags.printQr = hasAny("--qr", "-qr", "qr") || appHasSwitch("qr")
  // Headless mode - skip window creation, start only remote server
  flags.headless = hasAny("--headless", "-hl", "headless") || appHasSwitch("headless") || strToBool(process.env.ACP_HEADLESS)



  if (flags.llm || flags.tools || flags.keybinds || flags.app || flags.ui || flags.mcp || flags.acp) {
    // Small banner so users can see debugs are enabled
    const enabled: string[] = []
    if (flags.llm) enabled.push("LLM")
    if (flags.tools) enabled.push("TOOLS")
    if (flags.keybinds) enabled.push("KEYBINDS")
    if (flags.app) enabled.push("APP")
    if (flags.ui) enabled.push("UI")
    if (flags.mcp) enabled.push("MCP")
    if (flags.acp) enabled.push("ACP")
    // eslint-disable-next-line no-console
    console.log(
      `[DEBUG] Enabled: ${enabled.join(", ")} (argv: ${argv.filter((a) => a.startsWith("--debug") || a.startsWith("-d") || a.startsWith("debug") || ["d", "dt", "dl", "dk", "da", "dapp", "dui", "dmcp", "dacp"].includes(a)).join(" ") || "none"})`,
    )
  }

  return { ...flags }
}

export function isDebugLLM(): boolean {
  return flags.llm || flags.all
}

export function isDebugTools(): boolean {
  return flags.tools || flags.all
}

export function isDebugKeybinds(): boolean {
  return flags.keybinds || flags.all
}



export function isDebugApp(): boolean {
  return flags.app || flags.all
}

export function isDebugUI(): boolean {
  return flags.ui || flags.all
}

export function isDebugMCP(): boolean {
  return flags.mcp || flags.all
}

export function isDebugACP(): boolean {
  return flags.acp || flags.all
}

export function isPrintQR(): boolean {
  return flags.printQr
}

export function isHeadless(): boolean {
  return flags.headless
}

function ts(): string {
  const d = new Date()
  return d.toISOString()
}

export function logLLM(...args: any[]) {
  if (!isDebugLLM()) return
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][LLM]`, ...args)
}

export function logTools(...args: any[]) {
  if (!isDebugTools()) return
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][TOOLS]`, ...args)
}

export function logKeybinds(...args: any[]) {
  if (!isDebugKeybinds()) return
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][KEYBINDS]`, ...args)
}

export function logApp(...args: unknown[]) {
  if (!isDebugApp()) return
  const formattedArgs = args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}\n${arg.stack}`
    }
    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg, null, 2)
      } catch {
        return String(arg)
      }
    }
    return arg
  })
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][APP]`, ...formattedArgs)
}

export function logUI(...args: any[]) {
  if (!isDebugUI()) return
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][UI]`, ...args)
}

export function logMCP(direction: "REQUEST" | "RESPONSE", serverName: string, data: unknown) {
  if (!isDebugMCP()) return
  const prefix = direction === "REQUEST" ? "→" : "←"
  const formatted = typeof data === "object" && data !== null
    ? JSON.stringify(data, null, 2)
    : String(data)
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [MCP] ${prefix} [${serverName}]\n${formatted}`)
}

export function logACP(direction: "REQUEST" | "RESPONSE" | "NOTIFICATION", agentName: string, method: string, data: unknown) {
  if (!isDebugACP()) return
  const prefix = direction === "REQUEST" ? "→" : direction === "RESPONSE" ? "←" : "◆"
  const formatted = typeof data === "object" && data !== null
    ? JSON.stringify(data, null, 2)
    : String(data)
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [ACP] ${prefix} [${agentName}] ${method}\n${formatted}`)
}

export function getDebugFlags(): DebugFlags {
  return { ...flags }
}
