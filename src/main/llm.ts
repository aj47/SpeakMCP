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

  // Use proxy server for all chat completions
  if (!config.authToken) {
    throw new Error("Authentication required. Please sign in to use SpeakMCP.")
  }

  const isDevelopment = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged
  const baseUrl = isDevelopment
    ? "http://localhost:8788"  // Proxy worker port
    : "https://speakmcp-proxy.techfren.workers.dev"

  const chatResponse = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      temperature: 0,
      model: "gemma2-9b-it", // Default to Groq model via proxy
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

  // Use proxy server for all chat completions
  if (!config.authToken) {
    throw new Error("Authentication required. Please sign in to use SpeakMCP.")
  }

  const isDevelopment = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged
  const baseUrl = isDevelopment
    ? "http://localhost:8788"  // Proxy worker port
    : "https://speakmcp-proxy.techfren.workers.dev"

  const model = "gemma2-9b-it" // Default to Groq model via proxy

  const chatResponse = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.authToken}`,
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
