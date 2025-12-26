/**
 * Centralized TIPC handlers index
 * Combines all domain-specific handler modules into a single export
 */

import { appHandlers } from "./app-handlers"
import { panelHandlers } from "./panel-handlers"
import { agentHandlers } from "./agent-handlers"
import { oauthHandlers } from "./oauth-handlers"
import { recordingHandlers } from "./recording-handlers"
import { configHandlers } from "./config-handlers"
import { mcpConfigHandlers } from "./mcp-config-handlers"
import { mcpServerHandlers } from "./mcp-server-handlers"
import { ttsHandlers } from "./tts-handlers"
import { modelsHandlers } from "./models-handlers"
import { conversationHandlers } from "./conversation-handlers"
import { profileHandlers } from "./profile-handlers"
import { messageQueueHandlers } from "./message-queue-handlers"
import { uiHandlers } from "./ui-handlers"

// Combine all handlers into a single object
export const handlers = {
  ...appHandlers,
  ...panelHandlers,
  ...agentHandlers,
  ...oauthHandlers,
  ...recordingHandlers,
  ...configHandlers,
  ...mcpConfigHandlers,
  ...mcpServerHandlers,
  ...ttsHandlers,
  ...modelsHandlers,
  ...conversationHandlers,
  ...profileHandlers,
  ...messageQueueHandlers,
  ...uiHandlers,
}

// Export individual handler groups for granular imports if needed
export {
  appHandlers,
  panelHandlers,
  agentHandlers,
  oauthHandlers,
  recordingHandlers,
  configHandlers,
  mcpConfigHandlers,
  mcpServerHandlers,
  ttsHandlers,
  modelsHandlers,
  conversationHandlers,
  profileHandlers,
  messageQueueHandlers,
  uiHandlers,
}
