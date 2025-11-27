/**
 * Debug logging utilities for the renderer process
 * These logs will appear in the browser console (DevTools)
 *
 * Debug flags are synchronized from the main process to ensure
 * consistent behavior across CLI flags like --debug-ui
 */

// Cache for debug flags from main process
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

/**
 * Initialize debug flags from main process.
 * Call this once at app startup (e.g., in main.tsx or App.tsx).
 */
export async function initDebugFlags(): Promise<void> {
  if (cachedFlags) return

  try {
    // Use the TIPC client to fetch flags from main process
    const { tipcClient } = await import('./tipc-client')
    cachedFlags = await tipcClient.getDebugFlags()
  } catch (error) {
    // Fallback to localStorage-based flags if main process call fails
    // eslint-disable-next-line no-console
    console.warn('[DEBUG] Failed to fetch debug flags from main, using fallback:', error)
    cachedFlags = {
      llm: false,
      tools: false,
      keybinds: false,
      app: false,
      ui: localStorage.getItem('DEBUG_UI') === 'true' || localStorage.getItem('DEBUG') === '*',
      all: localStorage.getItem('DEBUG') === '*',
    }
  }
}

/**
 * Get debug flags synchronously. Returns cached flags or defaults.
 * Triggers async fetch if not yet initialized.
 */
function getFlags(): DebugFlags {
  if (cachedFlags) return cachedFlags

  // Trigger async initialization if not started
  if (!flagsFetchPromise) {
    flagsFetchPromise = initDebugFlags().then(() => cachedFlags!)
  }

  // Return fallback while loading
  return {
    llm: false,
    tools: false,
    keybinds: false,
    app: false,
    ui: import.meta.env.DEV || localStorage.getItem('DEBUG_UI') === 'true' || localStorage.getItem('DEBUG') === '*',
    all: localStorage.getItem('DEBUG') === '*',
  }
}

/**
 * Check if UI debug is enabled
 */
export function isDebugUI(): boolean {
  const flags = getFlags()
  return flags.ui || flags.all
}

function ts(): string {
  const d = new Date()
  return d.toISOString()
}


// Safely stringify values for single-line logs captured by main console logger
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

/**
 * Log UI-related debug information
 * Includes focus events, re-renders, state changes, etc.
 */
export function logUI(...args: any[]) {
  if (!isDebugUI()) return

  // Deep clone objects to avoid "[Object]" in console
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

  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [DEBUG][UI]`, ...clonedArgs)
}

/**
 * Log component lifecycle events
 */
export function logComponentLifecycle(componentName: string, event: string, data?: any) {
  logUI(`[${componentName}] ${event}`, data)
}

/**
 * Log focus events
 */
export function logFocus(element: string, event: 'focus' | 'blur', data?: any) {
  logUI(`[FOCUS] ${element} ${event}`, data)
}

/**
 * Log state changes
 */
export function logStateChange(component: string, stateName: string, oldValue: any, newValue: any) {
  const detail = safeStringify({ from: oldValue, to: newValue })
  // Important: put details into the same string so main console capture includes them
  logUI(`[STATE] ${component}.${stateName}: ${detail}`)
}


/**
 * Structured expand-state logging for consistent capture in killswitch logs.
 * Example line:
 *   [EXPAND] ActiveAgentsSidebar toggle {"from":true,"to":false}
 */
export function logExpand(component: string, event: string, data?: any) {
  const suffix = data !== undefined ? ` ${safeStringify(data)}` : ''
  logUI(`[EXPAND] ${component} ${event}${suffix}`)
}

/**
 * Log re-renders
 */
export function logRender(componentName: string, reason?: string, props?: any) {
  logUI(`[RENDER] ${componentName}`, reason ? `(${reason})` : '', props)
}

