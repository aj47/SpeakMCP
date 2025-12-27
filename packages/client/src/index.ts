export { SpeakMCPClient } from './client.js'
export { HttpClient } from './http.js'
export { WebSocketClient, type WebSocketStatus, type WebSocketClientOptions } from './websocket.js'
export * from './types.js'

// Factory function for creating a client
import type { ClientConfig } from './types.js'
import { SpeakMCPClient } from './client.js'

export function createSpeakMCPClient(config: ClientConfig): SpeakMCPClient {
  return new SpeakMCPClient(config)
}

// Default export
export default SpeakMCPClient

