/**
 * LLM-driven TTS text preprocessing
 * Uses an LLM to intelligently convert text to speech-friendly format
 * for more natural and context-aware speech output.
 */

import { makeTextCompletionWithFetch } from "./llm-fetch"
import { configStore } from "./config"
import { Config } from "@shared/types"
import { diagnosticsService } from "./diagnostics"
import { preprocessTextForTTS as regexPreprocessTextForTTS } from "@speakmcp/shared"

/**
 * Builds a dynamic TTS preprocessing prompt based on user config settings.
 * Respects ttsRemoveCodeBlocks, ttsRemoveUrls, and ttsConvertMarkdown settings.
 */
function buildTTSPreprocessingPrompt(config: Config): string {
  const instructions: string[] = []

  // Only add instructions for enabled options
  if (config.ttsRemoveCodeBlocks ?? true) {
    instructions.push("- Remove code blocks and replace with brief description if relevant")
  }
  if (config.ttsRemoveUrls ?? true) {
    instructions.push("- Remove URLs but mention if a link was shared")
  }
  if (config.ttsConvertMarkdown ?? true) {
    instructions.push("- Convert markdown formatting to natural speech")
  }

  // Always include these LLM-specific enhancements (the main value of LLM preprocessing)
  instructions.push("- Expand abbreviations and acronyms appropriately (e.g., \"Dr.\" → \"Doctor\", \"API\" → \"A P I\")")
  instructions.push("- Convert technical symbols to spoken words (e.g., \"&&\" → \"and\", \"=>\" → \"arrow\")")
  instructions.push("- Remove or describe any content that wouldn't make sense when spoken aloud")
  instructions.push("- Keep the core meaning but optimize for listening")
  instructions.push("- Do NOT add any commentary, just output the converted text")

  return `Convert this AI response to natural spoken text.
${instructions.join("\n")}

Only output the converted text, nothing else.

Text to convert:
`
}

/**
 * Preprocesses text for TTS using an LLM for more natural speech output.
 * Falls back to regex-based preprocessing if LLM call fails.
 * 
 * @param text The raw text to preprocess for TTS
 * @param providerId Optional provider ID for the LLM call
 * @returns Preprocessed text suitable for TTS
 */
export async function preprocessTextForTTSWithLLM(
  text: string,
  providerId?: string
): Promise<string> {
  const config = configStore.get()
  
  // Use the configured TTS LLM provider, or fall back to transcript post-processing provider, or openai
  const llmProviderId = providerId || config.ttsLLMPreprocessingProviderId || config.transcriptPostProcessingProviderId || "openai"
  
  try {
    // Build the dynamic prompt based on user config, then append the text
    const prompt = buildTTSPreprocessingPrompt(config) + text

    // Make the LLM call
    const result = await makeTextCompletionWithFetch(prompt, llmProviderId)
    
    // If we got a result, return it
    if (result && result.trim().length > 0) {
      diagnosticsService.logInfo("tts-llm-preprocessing", "LLM preprocessing succeeded", {
        inputLength: text.length,
        outputLength: result.length,
        provider: llmProviderId
      })
      return result.trim()
    }
    
    // If empty result, fall back to regex
    throw new Error("LLM returned empty result")
  } catch (error) {
    // Log the error and fall back to regex-based preprocessing
    diagnosticsService.logWarning(
      "tts-llm-preprocessing",
      "LLM preprocessing failed, falling back to regex",
      error
    )

    // Fall back to regex-based preprocessing with user-configured options
    const preprocessingOptions = {
      removeCodeBlocks: config.ttsRemoveCodeBlocks ?? true,
      removeUrls: config.ttsRemoveUrls ?? true,
      convertMarkdown: config.ttsConvertMarkdown ?? true,
    }
    return regexPreprocessTextForTTS(text, preprocessingOptions)
  }
}

/**
 * Checks if LLM-based TTS preprocessing is enabled and available.
 * Returns true if the feature is enabled and API keys are configured.
 */
export function isLLMPreprocessingAvailable(): boolean {
  const config = configStore.get()
  
  if (!config.ttsUseLLMPreprocessing) {
    return false
  }
  
  // Check if the provider has API keys configured
  const providerId = config.ttsLLMPreprocessingProviderId || config.transcriptPostProcessingProviderId || "openai"
  
  switch (providerId) {
    case "openai":
      return !!config.openaiApiKey
    case "groq":
      return !!config.groqApiKey
    case "gemini":
      return !!config.geminiApiKey
    default:
      return !!config.openaiApiKey
  }
}

