export interface DebugFlags {
  llm: boolean
  tools: boolean
  keybinds: boolean
  all: boolean
}

const flags: DebugFlags = {
  llm: false,
  tools: false,
  keybinds: false,
  all: false,
}

function strToBool(v: string | undefined): boolean {
  if (!v) return false
  const s = v.toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

export function initDebugFlags(argv: string[] = process.argv): DebugFlags {
  // CLI flags
  const has = (name: string) => argv.includes(name)

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

  const all =
    has("--debug") ||
    has("--debug-all") ||
    envDebug === "*" ||
    envParts.includes("all")

  flags.llm = all || has("--debug-llm") || envLLM
  flags.tools = all || has("--debug-tools") || envTools
  flags.keybinds = all || has("--debug-keybinds") || envKeybinds
  flags.all = all

  if (flags.llm || flags.tools || flags.keybinds) {
    // Small banner so users can see debugs are enabled
    const enabled: string[] = []
    if (flags.llm) enabled.push("LLM")
    if (flags.tools) enabled.push("TOOLS")
    if (flags.keybinds) enabled.push("KEYBINDS")
    // eslint-disable-next-line no-console
    console.log(
      `[DEBUG] Enabled: ${enabled.join(", ")} (argv: ${argv.filter((a) => a.startsWith("--debug")).join(" ") || "none"})`,
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

export function getDebugFlags(): DebugFlags {
  return { ...flags }
}
