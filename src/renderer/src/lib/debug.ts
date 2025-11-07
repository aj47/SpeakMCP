/**
 * Debug logging utilities for the renderer process
 * These logs will appear in the browser console (DevTools)
 */

function ts(): string {
  const d = new Date()
  return d.toISOString()
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
  logUI(`[STATE] ${component}.${stateName}:`, { from: oldValue, to: newValue })
}

/**
 * Log re-renders
 */
export function logRender(componentName: string, reason?: string, props?: any) {
  logUI(`[RENDER] ${componentName}`, reason ? `(${reason})` : '', props)
}

