interface DebugFlags {
  llm: boolean
  tools: boolean
  keybinds: boolean
  app: boolean
  ui: boolean
  all: boolean
}

let cachedFlags: DebugFlags | null = null
let flagsFetchPromise: Promise<DebugFlags> | null = null

export async function initDebugFlags(): Promise<void> {
  if (cachedFlags) return

  try {
    const { tipcClient } = await import('./tipc-client')
    cachedFlags = await tipcClient.getDebugFlags()
  } catch (error) {
    console.warn('[DEBUG] Failed to fetch debug flags from main, using fallback:', error)
    cachedFlags = {
      llm: false,
      tools: false,
      keybinds: false,
      app: false,
      ui: import.meta.env.DEV || localStorage.getItem('DEBUG_UI') === 'true' || localStorage.getItem('DEBUG') === '*',
      all: localStorage.getItem('DEBUG') === '*',
    }
  }
}

function getFlags(): DebugFlags {
  if (cachedFlags) return cachedFlags

  if (!flagsFetchPromise) {
    flagsFetchPromise = initDebugFlags().then(() => cachedFlags!)
  }

  return {
    llm: false,
    tools: false,
    keybinds: false,
    app: false,
    ui: import.meta.env.DEV || localStorage.getItem('DEBUG_UI') === 'true' || localStorage.getItem('DEBUG') === '*',
    all: localStorage.getItem('DEBUG') === '*',
  }
}

export function isDebugUI(): boolean {
  const flags = getFlags()
  return flags.ui || flags.all
}

function ts(): string {
  const d = new Date()
  return d.toISOString()
}


function safeStringify(value: any): string {
  try {
    return JSON.stringify(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '[unserializable]'
    }
  }
}

export function logUI(...args: any[]) {
  if (!isDebugUI()) return

  const clonedArgs = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.parse(JSON.stringify(arg))
      } catch {
        return arg
      }
    }
    return arg
  })

  console.log(`[${ts()}] [DEBUG][UI]`, ...clonedArgs)
}

export function logComponentLifecycle(componentName: string, event: string, data?: any) {
  logUI(`[${componentName}] ${event}`, data)
}

export function logFocus(element: string, event: 'focus' | 'blur', data?: any) {
  logUI(`[FOCUS] ${element} ${event}`, data)
}

export function logStateChange(component: string, stateName: string, oldValue: any, newValue: any) {
  const detail = safeStringify({ from: oldValue, to: newValue })
  logUI(`[STATE] ${component}.${stateName}: ${detail}`)
}

export function logExpand(component: string, event: string, data?: any) {
  const suffix = data !== undefined ? ` ${safeStringify(data)}` : ''
  logUI(`[EXPAND] ${component} ${event}${suffix}`)
}

export function logRender(componentName: string, reason?: string, props?: any) {
  logUI(`[RENDER] ${componentName}`, reason ? `(${reason})` : '', props)
}

