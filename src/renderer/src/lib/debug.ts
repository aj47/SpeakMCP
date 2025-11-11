/**
 * Debug logging utilities for the renderer process
 * These logs will appear in the browser console (DevTools)
 */

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
  // Always log in development, can be controlled by localStorage in production
  const shouldLog =
    import.meta.env.DEV ||
    localStorage.getItem('DEBUG_UI') === 'true' ||
    localStorage.getItem('DEBUG') === '*'

  if (!shouldLog) return

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

