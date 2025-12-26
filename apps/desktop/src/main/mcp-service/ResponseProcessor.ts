import { configStore } from "../config"
import { logTools } from "../debug"

/**
 * ResponseProcessor - Processes and filters MCP tool responses
 *
 * Responsibilities:
 * - Filter tool responses to reduce context size
 * - Summarize large responses with chunking
 * - Apply configurable thresholds
 */
export class ResponseProcessor {
  /**
   * Filter tool responses to reduce context size
   * Uses a 50KB threshold - MCP servers handle their own pagination
   */
  filterToolResponse(
    _serverName: string,
    _toolName: string,
    content: Array<{ type: string; text: string }>
  ): Array<{ type: string; text: string }> {
    const TRUNCATION_LIMIT = 50000
    return content.map((item) => {
      if (item.text.length > TRUNCATION_LIMIT) {
        return {
          type: item.type,
          text: item.text.substring(0, TRUNCATION_LIMIT) + '\n\n[truncated]'
        }
      }
      return item
    })
  }

  /**
   * Process large tool responses with chunking and summarization
   */
  async processLargeToolResponse(
    serverName: string,
    toolName: string,
    content: Array<{ type: string; text: string }>,
    onProgress?: (message: string) => void
  ): Promise<Array<{ type: string; text: string }>> {
    const config = configStore.get()

    // Use configurable thresholds
    const LARGE_RESPONSE_THRESHOLD = config.mcpToolResponseLargeThreshold ?? 20000
    const CRITICAL_RESPONSE_THRESHOLD = config.mcpToolResponseCriticalThreshold ?? 50000

    // Check if processing is enabled
    if (!config.mcpToolResponseProcessingEnabled) {
      return content // Return unprocessed if disabled
    }

    return Promise.all(content.map(async (item) => {
      const responseSize = item.text.length

      // Small responses - no additional processing needed
      if (responseSize < LARGE_RESPONSE_THRESHOLD) {
        return item
      }

      // Large responses - apply intelligent summarization
      if (responseSize >= CRITICAL_RESPONSE_THRESHOLD) {
        // Notify user of processing if enabled
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Processing large response from ${serverName}:${toolName} (${Math.round(responseSize/1000)}KB)`)
        }

        // For very large responses, use aggressive summarization
        const summarized = await this.summarizeLargeResponse(
          item.text,
          serverName,
          toolName,
          'aggressive',
          onProgress
        )
        return {
          type: item.type,
          text: `[summarized]\n${summarized}`
        }
      } else {
        // Notify user of processing if enabled
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Processing response from ${serverName}:${toolName} (${Math.round(responseSize/1000)}KB)`)
        }

        // For moderately large responses, use gentle summarization
        const summarized = await this.summarizeLargeResponse(
          item.text,
          serverName,
          toolName,
          'gentle',
          onProgress
        )
        return {
          type: item.type,
          text: summarized
        }
      }
    }))
  }

  /**
   * Summarize large responses with context-aware strategies
   */
  private async summarizeLargeResponse(
    content: string,
    serverName: string,
    toolName: string,
    strategy: 'gentle' | 'aggressive',
    onProgress?: (message: string) => void
  ): Promise<string> {
    try {
      // Import summarization function from context-budget
      const { summarizeContent } = await import('../context-budget')

      // Create context-aware prompt based on server and tool
      const contextPrompt = this.createSummarizationPrompt(serverName, toolName, strategy)

      // For very large content, chunk it first
      if (content.length > 30000) {
        const config = configStore.get()
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Chunking large response (${Math.round(content.length/1000)}KB) for processing`)
        }
        return await this.chunkAndSummarize(content, contextPrompt, strategy, onProgress)
      }

      // For moderately large content, summarize directly
      const config = configStore.get()
      if (onProgress && config.mcpToolResponseProgressUpdates) {
        onProgress(`Summarizing response content`)
      }
      return await summarizeContent(content)
    } catch (error) {
      logTools('Failed to summarize large response:', error)
      // Fallback to simple truncation
      const maxLength = strategy === 'aggressive' ? 2000 : 5000
      return content.substring(0, maxLength) + '\n\n[truncated]'
    }
  }

  /**
   * Create summarization prompts
   * Uses generic prompts for all servers - no server-specific logic
   */
  private createSummarizationPrompt(
    serverName: string,
    toolName: string,
    strategy: 'gentle' | 'aggressive'
  ): string {
    const basePrompt = strategy === 'aggressive'
      ? 'Aggressively summarize this content, keeping only the most essential information:'
      : 'Summarize this content while preserving important details:'

    return `${basePrompt} This is output from ${serverName}:${toolName}.`
  }

  /**
   * Chunk large content and summarize each chunk
   */
  private async chunkAndSummarize(
    content: string,
    contextPrompt: string,
    strategy: 'gentle' | 'aggressive',
    onProgress?: (message: string) => void
  ): Promise<string> {
    const config = configStore.get()
    const baseChunkSize = config.mcpToolResponseChunkSize ?? 15000
    const chunkSize = strategy === 'aggressive' ? Math.floor(baseChunkSize * 0.67) : baseChunkSize
    const chunks: string[] = []

    // Split content into manageable chunks
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize))
    }

    // Summarize each chunk
    const { summarizeContent } = await import('../context-budget')
    const summarizedChunks = await Promise.all(
      chunks.map(async (chunk, index) => {
        const config = configStore.get()
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Summarizing chunk ${index + 1}/${chunks.length}`)
        }
        const chunkPrompt = `${contextPrompt} (Part ${index + 1}/${chunks.length})\n\n${chunk}`
        return await summarizeContent(chunkPrompt)
      })
    )

    // Combine summarized chunks
    const combined = summarizedChunks.join('\n\n---\n\n')

    // If combined result is still too large, summarize once more
    if (combined.length > (strategy === 'aggressive' ? 3000 : 8000)) {
      const config = configStore.get()
      if (onProgress && config.mcpToolResponseProgressUpdates) {
        onProgress(`Creating final summary from ${chunks.length} processed chunks`)
      }
      const finalPrompt = `${contextPrompt} (Final summary of ${chunks.length} parts)\n\n${combined}`
      return await summarizeContent(finalPrompt)
    }

    return combined
  }
}
