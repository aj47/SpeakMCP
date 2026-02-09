/**
 * Server runtime state - stores actual listening port and bind address.
 * Separated from server.ts to avoid circular dependencies with tunnel-service.
 */

let actualListeningPort: number | null = null
let actualListeningBind: string | null = null

/**
 * Get the actual port the server is listening on.
 * Returns null if server is not running.
 */
export function getActualListeningPort(): number | null {
  return actualListeningPort
}

/**
 * Get the actual bind address the server is listening on.
 * Returns null if server is not running.
 */
export function getActualListeningBind(): string | null {
  return actualListeningBind
}

/**
 * Set the actual listening port and bind (called after server starts).
 */
export function setServerListeningInfo(port: number, bind: string): void {
  actualListeningPort = port
  actualListeningBind = bind
}

/**
 * Clear the listening info (called when server stops).
 */
export function clearServerListeningInfo(): void {
  actualListeningPort = null
  actualListeningBind = null
}

