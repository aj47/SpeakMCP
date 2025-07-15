import { GoogleGenerativeAI } from "@google/generative-ai"
import { configStore } from "./config"
import { MCPTool, MCPToolCall, LLMToolCallResponse } from "./mcp-service"

/**
 * Validates that a parsed JSON object has the expected structure for LLM tool responses
 */
function isValidLLMResponse(obj: any): obj is LLMToolCallResponse {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  // Must have either content or toolCalls (or both)
  const hasContent = typeof obj.content === 'string'
  const hasToolCalls = Array.isArray(obj.toolCalls) && obj.toolCalls.length > 0

  if (!hasContent && !hasToolCalls) {
    return false
  }

  // If toolCalls exist, validate their structure
  if (hasToolCalls) {
    for (const toolCall of obj.toolCalls) {
      if (!toolCall || typeof toolCall !== 'object' ||
          typeof toolCall.name !== 'string' ||
          !toolCall.arguments || typeof toolCall.arguments !== 'object') {
        return false
      }
    }
  }

  return true
}

/**
 * Attempts to extract and parse JSON from various response formats
 * Handles cases where JSON is wrapped in markdown code blocks or mixed with text
 */
function extractAndParseJSON(responseText: string): LLMToolCallResponse | null {
  // First, try direct JSON parsing
  try {
    const parsed = JSON.parse(responseText.trim())
    if (isValidLLMResponse(parsed)) {
      return parsed
    }
  } catch (error) {
    // Continue to extraction methods
  }

  // Try to extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi
  let match = codeBlockRegex.exec(responseText)

  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (isValidLLMResponse(parsed)) {
        return parsed
      }
    } catch (error) {
      // Continue to next extraction method
    }
  }

  // Try to find JSON object in the text (look for { ... })
  // Use a more sophisticated approach to find balanced braces
  const findJsonObjects = (text: string): string[] => {
    const objects: string[] = []
    let braceCount = 0
    let start = -1

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (braceCount === 0) {
          start = i
        }
        braceCount++
      } else if (text[i] === '}') {
        braceCount--
        if (braceCount === 0 && start !== -1) {
          objects.push(text.substring(start, i + 1))
          start = -1
        }
      }
    }

    return objects
  }

  const jsonObjects = findJsonObjects(responseText)

  if (jsonObjects.length > 0) {
    // Try each potential JSON object, starting with the largest
    const sortedObjects = jsonObjects.sort((a, b) => b.length - a.length)

    for (const potentialJson of sortedObjects) {
      try {
        const parsed = JSON.parse(potentialJson.trim())
        if (isValidLLMResponse(parsed)) {
          return parsed
        }
      } catch (error) {
        // Continue to next match
      }
    }
  }

  return null
}

export async function postProcessTranscript(transcript: string) {
  const config = configStore.get()

  if (
    !config.transcriptPostProcessingEnabled ||
    !config.transcriptPostProcessingPrompt
  ) {
    return transcript
  }

  const prompt = config.transcriptPostProcessingPrompt.replace(
    "{transcript}",
    transcript,
  )

  const chatProviderId = config.transcriptPostProcessingProviderId

  if (chatProviderId === "gemini") {
    if (!config.geminiApiKey) throw new Error("Gemini API key is required")

    const gai = new GoogleGenerativeAI(config.geminiApiKey)
    const geminiModel = config.transcriptPostProcessingGeminiModel || "gemini-1.5-flash-002"
    const gModel = gai.getGenerativeModel({ model: geminiModel })

    const result = await gModel.generateContent([prompt], {
      baseUrl: config.geminiBaseUrl,
    })
    return result.response.text().trim()
  }

  const chatBaseUrl =
    chatProviderId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const chatResponse = await fetch(`${chatBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      temperature: 0,
      model:
        chatProviderId === "groq"
          ? config.transcriptPostProcessingGroqModel || "gemma2-9b-it"
          : config.transcriptPostProcessingOpenaiModel || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
    }),
  })

  if (!chatResponse.ok) {
    const message = `${chatResponse.statusText} ${(await chatResponse.text()).slice(0, 300)}`

    throw new Error(message)
  }

  const chatJson = await chatResponse.json()
  return chatJson.choices[0].message.content.trim()
}

export async function processTranscriptWithTools(
  transcript: string,
  availableTools: MCPTool[]
): Promise<LLMToolCallResponse> {
  const config = configStore.get()

  if (!config.mcpToolsEnabled) {
    return { content: transcript }
  }

  // Create system prompt with available tools
  const systemPrompt = config.mcpToolsSystemPrompt || `You are a helpful assistant that can execute tools based on user requests.

Available tools:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.

CRITICAL: When calling tools, you MUST use the EXACT tool name as listed above, including any server prefixes (like "server:tool_name"). Do not modify or shorten the tool names.

When the user's request requires using a tool, respond with this exact JSON format:
{
  "toolCalls": [
    {
      "name": "exact_tool_name_from_list_above",
      "arguments": { "param1": "value1", "param2": "value2" }
    }
  ],
  "content": "Brief explanation of what you're doing"
}

If no tools are needed, respond with this exact JSON format:
{
  "content": "Your response text here"
}

Examples:

User: "Create a file called test.txt with hello world"
Response:
{
  "toolCalls": [
    {
      "name": "filesystem:write_file",
      "arguments": { "path": "test.txt", "content": "hello world" }
    }
  ],
  "content": "Creating test.txt file with hello world content"
}

User: "What's the weather like?"
Response:
{
  "content": "I don't have access to weather information. You might want to check a weather app or website."
}

Remember: Respond with ONLY the JSON object, no markdown formatting, no code blocks, no additional text.`

  const messages = [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: transcript
    }
  ]

  if (chatProviderId === "gemini") {
    console.log("[MCP-DEBUG] Using Gemini for LLM processing")
    if (!config.geminiApiKey) throw new Error("Gemini API key is required")

    const gai = new GoogleGenerativeAI(config.geminiApiKey)
    const geminiModel = config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    console.log(`[MCP-DEBUG] Using Gemini model: ${geminiModel}`)
    const gModel = gai.getGenerativeModel({ model: geminiModel })

    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
    console.log(`[MCP-DEBUG] Sending prompt to Gemini:`, prompt)

    const result = await gModel.generateContent([prompt], {
      baseUrl: config.geminiBaseUrl,
    })

    const responseText = result.response.text().trim()
    console.log(`[MCP-DEBUG] Gemini response:`, responseText)

    const parsed = extractAndParseJSON(responseText)
    if (parsed) {
      console.log(`[MCP-DEBUG] ✅ Successfully parsed Gemini JSON response:`, parsed)
      return parsed
    } else {
      console.log(`[MCP-DEBUG] ⚠️ Failed to extract JSON from Gemini response, returning as content`)
      return { content: responseText }
    }
  }

  console.log(`[MCP-DEBUG] Using ${chatProviderId} for LLM processing`)

  const chatBaseUrl =
    chatProviderId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const model = chatProviderId === "groq"
    ? config.mcpToolsGroqModel || "gemma2-9b-it"
    : config.mcpToolsOpenaiModel || "gpt-4o-mini"

  console.log(`[MCP-DEBUG] Using model: ${model}`)
  console.log(`[MCP-DEBUG] Sending request to: ${chatBaseUrl}/chat/completions`)

  const chatResponse = await fetch(`${chatBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      temperature: 0,
      model,
      messages,
    }),
  })

  if (!chatResponse.ok) {
    const errorText = await chatResponse.text()
    const message = `${chatResponse.statusText} ${errorText.slice(0, 300)}`
    throw new Error(message)
  }

  const chatJson = await chatResponse.json()
  const responseContent = chatJson.choices[0].message.content.trim()

  const parsed = extractAndParseJSON(responseContent)
  if (parsed) {
    console.log(`[MCP-DEBUG] ✅ Successfully parsed LLM JSON response:`, parsed)
    return parsed
  } else {
    console.log(`[MCP-DEBUG] ⚠️ Failed to extract JSON from LLM response, returning as content`)
    return { content: responseContent }
  }
}
