/**
 * Loop Agent Processor
 * Handles the actual agent session execution for loop triggers.
 * This is extracted to a separate file to avoid circular dependencies with tipc.ts.
 */

import { configStore } from "./config"
import { logApp, logLLM } from "./debug"
import { mcpService, MCPToolResult } from "./mcp-service"
import { processTranscriptWithAgentMode } from "./llm"
import { agentSessionTracker } from "./agent-session-tracker"
import { state, agentSessionStateManager } from "./state"
import type { SessionProfileSnapshot } from "../shared/types"

/**
 * Process an agent session triggered by a loop.
 * This mirrors the logic in tipc.ts processWithAgentMode, but is specifically for loop-triggered sessions.
 *
 * @param prompt - The prompt text to send to the agent
 * @param conversationId - The conversation ID for this session
 * @param sessionId - The session ID (already created by loop-service)
 * @param profileSnapshot - Optional profile snapshot for session isolation
 */
export async function processLoopAgentSession(
  prompt: string,
  conversationId: string,
  sessionId: string,
  profileSnapshot?: SessionProfileSnapshot
): Promise<void> {
  const config = configStore.get()
  const effectiveMaxIterations = config.mcpUnlimitedIterations ? Infinity : (config.mcpMaxIterations ?? 10)

  logLLM(`[LoopAgentProcessor] Starting session ${sessionId} for loop, prompt: "${prompt.substring(0, 50)}..."`)

  try {
    // Initialize MCP services
    await mcpService.initialize()
    mcpService.registerExistingProcessesWithAgentManager()

    // Get available tools filtered by profile snapshot if available
    const availableTools = profileSnapshot?.mcpServerConfig
      ? mcpService.getAvailableToolsForProfile(profileSnapshot.mcpServerConfig)
      : mcpService.getAvailableTools()

    // Tool execution function
    const executeToolCall = async (
      toolCall: any,
      onProgress?: (message: string) => void
    ): Promise<MCPToolResult> => {
      return await mcpService.executeToolCall(
        toolCall,
        onProgress,
        false,
        sessionId,
        profileSnapshot?.mcpServerConfig
      )
    }

    // Process the agent session
    const agentResult = await processTranscriptWithAgentMode(
      prompt,
      availableTools,
      executeToolCall,
      effectiveMaxIterations,
      [], // No previous conversation history for loop-triggered sessions
      conversationId,
      sessionId,
      undefined, // No progress callback needed for background execution
      profileSnapshot
    )

    // Mark session as completed
    agentSessionTracker.completeSession(sessionId, "Loop agent completed successfully")
    logLLM(`[LoopAgentProcessor] Session ${sessionId} completed successfully`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    logLLM(`[LoopAgentProcessor] Session ${sessionId} failed:`, errorMessage)
    agentSessionTracker.errorSession(sessionId, errorMessage)
  } finally {
    // Clean up session state
    agentSessionStateManager.cleanupSession(sessionId)
    logLLM(`[LoopAgentProcessor] Session ${sessionId} cleanup complete`)
  }
}

