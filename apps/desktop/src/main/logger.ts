/**
 * Structured logging module for the main process.
 *
 * This module provides a consistent, structured logging interface that:
 * - Outputs JSON-formatted logs for easy parsing and aggregation
 * - Supports log levels (debug, info, warn, error)
 * - Includes timestamps and context in all log entries
 * - Integrates with the existing debug flag system
 * - Can be extended to support external logging services
 *
 * Usage:
 * ```ts
 * import { createLogger } from './logger'
 *
 * const logger = createLogger('mcp-service')
 * logger.info({ serverId: 'foo' }, 'Server connected')
 * logger.error({ error, context }, 'Failed to execute tool')
 * ```
 */

import { isDebugLLM, isDebugTools, isDebugKeybinds, isDebugApp } from "./debug"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogContext {
  [key: string]: unknown
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

type LogMethod = (context: LogContext | string, message?: string) => void

export interface Logger {
  debug: LogMethod
  info: LogMethod
  warn: LogMethod
  error: LogMethod
  child: (context: LogContext) => Logger
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Minimum log level - can be configured via environment
function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel
  }
  // In development, show all logs; in production, show info and above
  return process.env.NODE_ENV === "development" ? "debug" : "info"
}

function shouldLog(level: LogLevel): boolean {
  const minLevel = getMinLevel()
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel]
}

function formatError(error: unknown): LogEntry["error"] | undefined {
  if (!error) return undefined

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    name: "UnknownError",
    message: String(error),
  }
}

function formatLogEntry(entry: LogEntry): string {
  // In development, use a more readable format
  if (process.env.NODE_ENV === "development") {
    const { timestamp, level, module, message, context, error } = entry
    const levelColors: Record<LogLevel, string> = {
      debug: "\x1b[36m", // cyan
      info: "\x1b[32m", // green
      warn: "\x1b[33m", // yellow
      error: "\x1b[31m", // red
    }
    const reset = "\x1b[0m"
    const dim = "\x1b[2m"

    let output = `${dim}${timestamp}${reset} ${levelColors[level]}[${level.toUpperCase()}]${reset} ${dim}[${module}]${reset} ${message}`

    if (context && Object.keys(context).length > 0) {
      output += ` ${dim}${JSON.stringify(context)}${reset}`
    }

    if (error) {
      output += `\n  ${levelColors.error}${error.name}: ${error.message}${reset}`
      if (error.stack) {
        output += `\n${dim}${error.stack}${reset}`
      }
    }

    return output
  }

  // In production, output JSON for log aggregation
  return JSON.stringify(entry)
}

function writeLog(entry: LogEntry): void {
  const formatted = formatLogEntry(entry)

  switch (entry.level) {
    case "error":
      // eslint-disable-next-line no-console
      console.error(formatted)
      break
    case "warn":
      // eslint-disable-next-line no-console
      console.warn(formatted)
      break
    default:
      // eslint-disable-next-line no-console
      console.log(formatted)
  }
}

// Module-specific debug checks for backward compatibility
function isModuleDebugEnabled(module: string): boolean {
  const moduleLower = module.toLowerCase()
  if (moduleLower.includes("llm")) return isDebugLLM()
  if (moduleLower.includes("tool") || moduleLower.includes("mcp")) return isDebugTools()
  if (moduleLower.includes("keyboard") || moduleLower.includes("keybind")) return isDebugKeybinds()
  if (moduleLower.includes("app")) return isDebugApp()
  return true // Default to enabled for other modules
}

/**
 * Creates a logger instance for a specific module.
 *
 * @param module - The name of the module (e.g., 'mcp-service', 'llm', 'keyboard')
 * @param baseContext - Optional base context to include in all log entries
 */
export function createLogger(module: string, baseContext?: LogContext): Logger {
  const log = (level: LogLevel, contextOrMessage: LogContext | string, message?: string): void => {
    // Check if logging is enabled for this level
    if (!shouldLog(level)) return

    // For debug level, also check module-specific debug flags
    if (level === "debug" && !isModuleDebugEnabled(module)) return

    let context: LogContext | undefined
    let msg: string

    if (typeof contextOrMessage === "string") {
      msg = contextOrMessage
      context = baseContext
    } else {
      msg = message || ""
      context = { ...baseContext, ...contextOrMessage }
    }

    // Extract error from context if present
    let error: LogEntry["error"] | undefined
    if (context?.error) {
      error = formatError(context.error)
      // Remove error from context to avoid duplication
      const { error: _, ...restContext } = context
      context = Object.keys(restContext).length > 0 ? restContext : undefined
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message: msg,
      context,
      error,
    }

    writeLog(entry)
  }

  return {
    debug: (contextOrMessage, message) => log("debug", contextOrMessage, message),
    info: (contextOrMessage, message) => log("info", contextOrMessage, message),
    warn: (contextOrMessage, message) => log("warn", contextOrMessage, message),
    error: (contextOrMessage, message) => log("error", contextOrMessage, message),

    /**
     * Creates a child logger with additional base context.
     */
    child: (additionalContext: LogContext): Logger => {
      return createLogger(module, { ...baseContext, ...additionalContext })
    },
  }
}

// Pre-configured loggers for common modules
export const appLogger = createLogger("app")
export const llmLogger = createLogger("llm")
export const mcpLogger = createLogger("mcp")
export const keyboardLogger = createLogger("keyboard")
export const ipcLogger = createLogger("ipc")

export default createLogger
