/**
 * Groq LLM Provider
 * Extends OpenAI-compatible provider with Groq-specific defaults
 */

import { OpenAIProvider } from "./openai"
import type { LLMProviderConstructorConfig } from "./base"

/**
 * Groq provider implementation
 * Uses OpenAI-compatible API with Groq-specific configuration
 */
export class GroqProvider extends OpenAIProvider {
  override readonly id = "groq"
  override readonly displayName = "Groq"

  constructor(config: LLMProviderConstructorConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
      mcpModel: config.mcpModel || "llama-3.3-70b-versatile",
      transcriptModel: config.transcriptModel || "llama-3.1-70b-versatile",
    })
  }

  override supportsJsonMode(model?: string): boolean {
    const modelName = model || this.getModel("mcp")
    return (
      modelName.includes("llama") ||
      modelName.includes("mixtral") ||
      modelName.includes("gemma") ||
      modelName.includes("moonshotai/kimi-k2-instruct") ||
      modelName.includes("openai/gpt-oss")
    )
  }
}
