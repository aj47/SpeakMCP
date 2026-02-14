/**
 * Debug logging utilities for SpeakMCP shared package
 */

export function log(...args: unknown[]): void {
  console.log('[SpeakMCP]', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[SpeakMCP]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[SpeakMCP]', ...args);
}

export function debug(...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.debug('[SpeakMCP]', ...args);
  }
}
