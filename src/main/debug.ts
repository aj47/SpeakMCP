export interface DebugFlags {
  llm: boolean
  tools: boolean
  keybinds: boolean
  app: boolean
  all: boolean
}

const flags: DebugFlags = {
  llm: false,
  tools: false,
  keybinds: false,
  app: false,
  all: false,
}

function strToBool(v: string | undefined): boolean {
  if (!v) return false
  const s = v.toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

export function initDebugFlags(argv: string[] = process.argv): DebugFlags {
  // CLI flags - support both long and short forms, with and without dashes
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

  const all =
    hasAny("--debug", "--debug-all", "-d", "-da", "debug", "debug-all", "d", "da") ||
    envDebug === "*" ||
    envParts.includes("all")

  flags.llm = all || hasAny("--debug-llm", "-dl", "debug-llm", "dl") || envLLM
  flags.tools = all || hasAny("--debug-tools", "-dt", "debug-tools", "dt") || envTools
  flags.keybinds = all || hasAny("--debug-keybinds", "-dk", "debug-keybinds", "dk") || envKeybinds

  flags.app = all || hasAny("--debug-app", "-dapp", "debug-app", "dapp") || envApp
  flags.all = all



  if (flags.llm || flags.tools || flags.keybinds || flags.app) {
    // Small banner so users can see debugs are enabled
    const enabled: string[] = []
    if (flags.llm) enabled.push("LLM")
    if (flags.tools) enabled.push("TOOLS")
    if (flags.keybinds) enabled.push("KEYBINDS")
    if (flags.app) enabled.push("APP")
    // eslint-disable-next-line no-console
    console.log(
      `[DEBUG] Enabled: ${enabled.join(", ")} (argv: ${argv.filter((a) => a.startsWith("--debug") || a.startsWith("-d") || a.startsWith("debug") || ["d", "dt", "dl", "dk", "da", "dapp"].includes(a)).join(" ") || "none"})`,
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

function ts(): string {
  const d = new Date()
  return d.toISOString()
}

export function logLLM(...args: any[]) {
  if (!isDebugLLM()) return
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][LLM]`, ...args)

  // Also log to debug logging service
  try {
    const { debugLoggingService } = require('./debug-logging-service')
    debugLoggingService.debug('LLM', message, args.length > 1 ? args.slice(1) : undefined)
  } catch {
    // Ignore if debug logging service is not available
  }
}

export function logTools(...args: any[]) {
  if (!isDebugTools()) return
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][TOOLS]`, ...args)

  // Also log to debug logging service
  try {
    const { debugLoggingService } = require('./debug-logging-service')
    debugLoggingService.debug('TOOLS', message, args.length > 1 ? args.slice(1) : undefined)
  } catch {
    // Ignore if debug logging service is not available
  }
}

export function logKeybinds(...args: any[]) {
  if (!isDebugKeybinds()) return
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][KEYBINDS]`, ...args)

  // Also log to debug logging service
  try {
    const { debugLoggingService } = require('./debug-logging-service')
    debugLoggingService.debug('KEYBINDS', message, args.length > 1 ? args.slice(1) : undefined)
  } catch {
    // Ignore if debug logging service is not available
  }
}



export function logApp(...args: any[]) {
  if (!isDebugApp()) return
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][APP]`, ...args)

  // Also log to debug logging service
  try {
    const { debugLoggingService } = require('./debug-logging-service')
    debugLoggingService.debug('APP', message, args.length > 1 ? args.slice(1) : undefined)
  } catch {
    // Ignore if debug logging service is not available
  }
}

export function getDebugFlags(): DebugFlags {
  return { ...flags }
}
