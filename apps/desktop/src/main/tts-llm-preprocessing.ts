/**
 * LLM-driven TTS text preprocessing
 * Uses an LLM to intelligently convert text to speech-friendly format
 * for more natural and context-aware speech output.
 */

import { makeTextCompletionWithFetch } from "./llm-fetch"
import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"
import { preprocessTextForTTS as regexPreprocessTextForTTS } from "@speakmcp/shared"

const TTS_PREPROCESSING_PROMPT = `Convert this AI response to natural spoken text.
- Remove code blocks and replace with brief description if relevant
- Remove URLs but mention if a link was shared
- Convert markdown formatting to natural speech
- Expand abbreviations and acronyms appropriately (e.g., "Dr." → "Doctor", "API" → "A P I")
- Convert technical symbols to spoken words (e.g., "&&" → "and", "=>" → "arrow")
- Remove or describe any content that wouldn't make sense when spoken aloud
- Keep the core meaning but optimize for listening
- Do NOT add any commentary, just output the converted text

Only output the converted text, nothing else.

Text to convert:
`

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
    // Build the prompt with the text to convert
    const prompt = TTS_PREPROCESSING_PROMPT + text
    
    // Make the LLM call
    const result = await makeTextCompletionWithFetch(prompt, llmProviderId)
    
    // If we got a result, return it
    if (result && result.trim().length > 0) {
      diagnosticsService.logDebug("tts-llm-preprocessing", "LLM preprocessing succeeded", {
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
    
    // Fall back to regex-based preprocessing
    return regexPreprocessTextForTTS(text)
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

