import { GoogleGenerativeAI } from "@google/generative-ai"
import { configStore } from "./config"
import { MCPTool, MCPToolCall, LLMToolCallResponse, MCPToolResult, mcpService } from "./mcp-service"
import { AgentProgressStep, AgentProgressUpdate } from "../shared/types"
import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { diagnosticsService } from "./diagnostics"
import { jsonrepair } from "jsonrepair"

/**
 * Use LLM to extract useful context from conversation history
 */
async function extractContextFromHistory(
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>,
  config: any
): Promise<{ contextSummary: string; resources: Array<{ type: string; id: string; parameter: string }> }> {
  if (conversationHistory.length === 0) {
    return { contextSummary: "", resources: [] }
  }

  // Create a condensed version of the conversation for analysis
  const conversationText = conversationHistory.map(entry => {
    let text = `${entry.role.toUpperCase()}: ${entry.content}`

    if (entry.toolCalls) {
      text += `\nTOOL_CALLS: ${entry.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(', ')}`
    }

    if (entry.toolResults) {
      text += `\nTOOL_RESULTS: ${entry.toolResults.map(tr => tr.isError ? 'ERROR' : 'SUCCESS').join(', ')}`
    }

    return text
  }).join('\n\n')

  const contextExtractionPrompt = `Analyze the following conversation history and extract useful context information that would be needed for continuing the conversation.

CONVERSATION HISTORY:
${conversationText}

Your task is to identify and extract:
1. Resource identifiers (session IDs, connection IDs, file handles, workspace IDs, etc.)
2. Important file paths or locations mentioned
3. Current state or status information
4. Any other context that would be useful for subsequent tool calls

Respond with a JSON object in this exact format:
{
  "contextSummary": "Brief summary of the current state and what has been accomplished",
  "resources": [
    {
      "type": "session|connection|handle|workspace|channel|other",
      "id": "the actual ID value",
      "parameter": "the parameter name this ID should be used for (e.g., sessionId, connectionId)"
    }
  ]
}

Focus on extracting actual resource identifiers that tools would need, not just mentioning them.
Only include resources that are currently active and usable.
Keep the contextSummary concise but informative.`

  try {
    const chatProviderId = config.mcpToolsProviderId || 'openai'
    const chatBaseUrl = chatProviderId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

    const model = chatProviderId === "groq"
      ? config.mcpToolsGroqModel || "gemma2-9b-it"
      : config.mcpToolsOpenaiModel || "gpt-4o-mini"

    const response = await fetch(`${chatBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        temperature: 0,
        model,
        messages: [
          {
            role: "system",
            content: "You are a context extraction assistant. Analyze conversation history and extract useful resource identifiers and context information. Always respond with valid JSON only."
          },
          {
            role: "user",
            content: contextExtractionPrompt
          }
        ],
      }),
    })

    if (!response.ok) {
      console.log(`[CONTEXT-EXTRACTION] ⚠️ LLM call failed: ${response.statusText}`)
      return { contextSummary: "", resources: [] }
    }

    const result = await response.json()
    const content = result.choices[0].message.content.trim()

    try {
      const parsed = JSON.parse(content)
      console.log(`[CONTEXT-EXTRACTION] ✅ Extracted context:`, parsed)
      return {
        contextSummary: parsed.contextSummary || "",
        resources: Array.isArray(parsed.resources) ? parsed.resources : []
      }
    } catch (parseError) {
      console.log(`[CONTEXT-EXTRACTION] ⚠️ Failed to parse LLM response as JSON:`, content)
      return { contextSummary: "", resources: [] }
    }
  } catch (error) {
    console.log(`[CONTEXT-EXTRACTION] ❌ Error during context extraction:`, error)
    return { contextSummary: "", resources: [] }
  }
}

/**
 * Analyze tool errors and provide recovery strategies
 */
function analyzeToolErrors(
  toolResults: MCPToolResult[],
  failedTools: string[],
  toolCalls: MCPToolCall[]
): { recoveryStrategy: string; errorTypes: string[] } {
  const errorTypes: string[] = []
  const errorMessages = toolResults
    .filter(r => r.isError)
    .map(r => r.content.map(c => c.text).join(' '))
    .join(' ')

  // Categorize error types
  if (errorMessages.includes('Session not found')) {
    errorTypes.push('session_lost')
  }
  if (errorMessages.includes('timeout') || errorMessages.includes('connection')) {
    errorTypes.push('connectivity')
  }
  if (errorMessages.includes('permission') || errorMessages.includes('access')) {
    errorTypes.push('permissions')
  }
  if (errorMessages.includes('not found') || errorMessages.includes('does not exist')) {
    errorTypes.push('resource_missing')
  }

  // Generate recovery strategy based on error types
  let recoveryStrategy = 'RECOVERY STRATEGIES:\n'

  if (errorTypes.includes('session_lost')) {
    recoveryStrategy += '- For session errors: Create a new session using ht_create_session first\n'
  }
  if (errorTypes.includes('connectivity')) {
    recoveryStrategy += '- For connectivity issues: Wait a moment and retry, or check if the service is running\n'
  }
  if (errorTypes.includes('permissions')) {
    recoveryStrategy += '- For permission errors: Try alternative file locations or check access rights\n'
  }
  if (errorTypes.includes('resource_missing')) {
    recoveryStrategy += '- For missing resources: Verify the resource exists or create it first\n'
  }

  if (errorTypes.length === 0) {
    recoveryStrategy += '- General: Try breaking down the task into smaller steps or use alternative tools\n'
  }

  return { recoveryStrategy, errorTypes }
}

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
 * Attempts to repair malformed JSON using the jsonrepair library
 * This handles common issues like unescaped newlines, quotes, and other special characters
 */
function repairAndParseJSON(jsonString: string): any | null {
  try {
    console.log("[JSON-REPAIR] 🔧 Attempting to repair JSON...")
    const repairedJson = jsonrepair(jsonString)
    console.log("[JSON-REPAIR] ✅ JSON repair successful")

    const parsed = JSON.parse(repairedJson)
    return parsed
  } catch (error) {
    console.log("[JSON-REPAIR] ❌ JSON repair failed:", error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Attempts to extract and parse JSON from various response formats
 * Handles cases where JSON is wrapped in markdown code blocks or mixed with text
 */
function extractAndParseJSON(responseText: string): LLMToolCallResponse | null {
  console.log("[JSON-PARSER] 🔍 Attempting to parse response:", responseText.substring(0, 200) + (responseText.length > 200 ? "..." : ""))

  // Helper function to try parsing with repair fallback
  const tryParseWithRepair = (jsonString: string, context: string): any | null => {
    // First try direct parsing
    try {
      const parsed = JSON.parse(jsonString.trim())
      if (isValidLLMResponse(parsed)) {
        console.log(`[JSON-PARSER] ✅ Direct JSON parsing successful (${context})`)
        return parsed
      }
    } catch (error) {
      console.log(`[JSON-PARSER] ❌ Direct JSON parsing failed (${context}):`, error instanceof Error ? error.message : String(error))
    }

    // If direct parsing fails, try JSON repair
    const repaired = repairAndParseJSON(jsonString.trim())
    if (repaired && isValidLLMResponse(repaired)) {
      console.log(`[JSON-PARSER] ✅ JSON repair successful (${context})`)
      return repaired
    } else if (repaired) {
      console.log(`[JSON-PARSER] ❌ Repaired JSON failed validation (${context})`)
    }

    return null
  }

  // First, try direct JSON parsing with repair fallback
  const directResult = tryParseWithRepair(responseText, "direct")
  if (directResult) {
    return directResult
  }

  // Try to extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi
  let match = codeBlockRegex.exec(responseText)

  if (match) {
    console.log("[JSON-PARSER] 📋 Found JSON in code block")
    const codeBlockResult = tryParseWithRepair(match[1], "code block")
    if (codeBlockResult) {
      return codeBlockResult
    }
  }

  // Try to find JSON object in the text (look for { ... })
  // Use a more sophisticated approach to find balanced braces
  const findJsonObjects = (text: string): string[] => {
    const objects: string[] = []
    let braceCount = 0
    let start = -1
    let inString = false
    let escapeNext = false

    for (let i = 0; i < text.length; i++) {
      const char = text[i]

      if (escapeNext) {
        escapeNext = false
        continue
      }

      if (char === '\\') {
        escapeNext = true
        continue
      }

      if (char === '"' && !escapeNext) {
        inString = !inString
        continue
      }

      if (inString) {
        continue
      }

      if (char === '{') {
        if (braceCount === 0) {
          start = i
        }
        braceCount++
      } else if (char === '}') {
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
  console.log("[JSON-PARSER] 🔍 Found", jsonObjects.length, "potential JSON objects")

  if (jsonObjects.length > 0) {
    // Try each potential JSON object, starting with the largest
    const sortedObjects = jsonObjects.sort((a, b) => b.length - a.length)

    for (let i = 0; i < sortedObjects.length; i++) {
      const potentialJson = sortedObjects[i]
      console.log("[JSON-PARSER] 🧪 Trying JSON object", i + 1, "of", sortedObjects.length, "- length:", potentialJson.length)

      const objectResult = tryParseWithRepair(potentialJson, `object ${i + 1}`)
      if (objectResult) {
        return objectResult
      }
    }
  }

  console.log("[JSON-PARSER] ❌ All parsing attempts failed")
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
  const baseSystemPrompt = config.mcpToolsSystemPrompt || `You are a helpful assistant that can execute tools based on user requests.`

  // Generate dynamic tool information including schemas
  const generateToolInfo = (tools: MCPTool[]) => {
    return tools.map(tool => {
      let info = `- ${tool.name}: ${tool.description}`

      // Add parameter schema if available
      if (tool.inputSchema && tool.inputSchema.properties) {
        const params = Object.entries(tool.inputSchema.properties)
          .map(([key, schema]: [string, any]) => {
            const type = schema.type || 'any'
            const required = tool.inputSchema.required?.includes(key) ? ' (required)' : ''
            return `${key}: ${type}${required}`
          })
          .join(', ')

        if (params) {
          info += `\n  Parameters: {${params}}`
        }
      }

      return info
    }).join('\n')
  }

  // Remove duplicates from available tools to prevent confusion
  const uniqueAvailableTools = availableTools.filter((tool, index, self) =>
    index === self.findIndex(t => t.name === tool.name)
  )

  // Always inject available tools into the system prompt
  const toolsList = uniqueAvailableTools.length > 0 ? `

Available tools:
${generateToolInfo(uniqueAvailableTools)}` : '\n\nNo tools are currently available.'

  const systemPrompt = baseSystemPrompt + toolsList + `

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.

CRITICAL: When calling tools, you MUST use the EXACT tool name as listed above, including any server prefixes (like "server:tool_name"). Do not modify or shorten the tool names. NEVER invent or hallucinate tool names that are not in the list above.

TOOL USAGE PATTERNS:
- Use the exact tool names as listed above, including any server prefixes
- Follow the parameter schemas provided by each tool's inputSchema
- When in doubt about parameters, prefer camelCase over snake_case naming

PARAMETER NAMING GUIDELINES:
- Different MCP servers may use different parameter naming conventions
- Common patterns: camelCase (sessionId), snake_case (session_id), kebab-case (session-id)
- If a tool call fails due to parameter naming, the system will automatically retry with corrected parameters
- Always use the exact parameter names specified in the tool's schema

ALWAYS prefer using available tools over suggesting manual approaches. If you can accomplish the task with the available tools, do it!

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

CRITICAL JSON FORMATTING RULES:
- Always escape special characters in JSON strings (newlines as \\n, quotes as \\\", backslashes as \\\\)
- Never include unescaped newlines, tabs, or control characters in JSON string values
- If you need to include multi-line text, use \\n for line breaks
- Always use double quotes for JSON strings, never single quotes
- Ensure all JSON is properly closed with matching braces and brackets

Examples:

User: "List the contents of my desktop"
Response:
{
  "toolCalls": [
    {
      "name": "Headless Terminal:ht_create_session",
      "arguments": {}
    }
  ],
  "content": "Creating a terminal session to list your desktop contents"
}

Follow-up after session created (sessionId: "abc-123"):
{
  "toolCalls": [
    {
      "name": "Headless Terminal:ht_execute_command",
      "arguments": {
        "sessionId": "abc-123",
        "command": "ls ~/Desktop"
      }
    }
  ],
  "content": "Listing desktop contents"
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

  const chatProviderId = config.mcpToolsProviderId

  // Debug: Log non-agent mode LLM call details
  console.log("[MCP-TOOLS-DEBUG] 🚀 Making non-agent LLM call")
  console.log("[MCP-TOOLS-DEBUG] 🔧 Provider:", chatProviderId || "openai (default)")
  console.log("[MCP-TOOLS-DEBUG] 📝 Messages count:", messages.length)
  messages.forEach((msg, i) => {
    const preview = msg.content.length > 200 ? msg.content.substring(0, 200) + "..." : msg.content
    console.log(`[MCP-TOOLS-DEBUG]   ${i + 1}. ${msg.role}: ${preview}`)
  })

  if (chatProviderId === "gemini") {
    const geminiModel = config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    console.log("[MCP-TOOLS-DEBUG] 🤖 Using Gemini model:", geminiModel)
    if (!config.geminiApiKey) throw new Error("Gemini API key is required")

    const gai = new GoogleGenerativeAI(config.geminiApiKey)
    const gModel = gai.getGenerativeModel({ model: geminiModel })

    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
    console.log("[MCP-TOOLS-DEBUG] 📤 Sending request to Gemini...")

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

export interface AgentModeResponse {
  content: string
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>
  totalIterations: number
}

// Helper function to emit progress updates to the renderer
function emitAgentProgress(update: AgentProgressUpdate) {
  const panel = WINDOWS.get("panel")
  if (!panel) {
    return
  }

  // Show the panel window if it's not visible
  if (!panel.isVisible()) {
    showPanelWindow()
  }

  try {
    const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
    if (!handlers.agentProgressUpdate) {
      return
    }

    handlers.agentProgressUpdate.send(update)
  } catch (error) {
    console.error("Failed to emit progress update:", error)
  }
}

// Helper function to create progress steps
function createProgressStep(
  type: AgentProgressStep["type"],
  title: string,
  description?: string,
  status: AgentProgressStep["status"] = "pending"
): AgentProgressStep {
  return {
    id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    type,
    title,
    description,
    status,
    timestamp: Date.now()
  }
}

// Helper function to analyze tool capabilities and match them to user requests
function analyzeToolCapabilities(availableTools: MCPTool[], transcript: string): { summary: string; relevantTools: MCPTool[] } {
  const transcriptLower = transcript.toLowerCase()
  const relevantTools: MCPTool[] = []

  // Define capability patterns based on common keywords and tool descriptions
  const patterns = {
    filesystem: {
      keywords: ['file', 'directory', 'folder', 'desktop', 'list', 'ls', 'contents', 'browse', 'create', 'write', 'read'],
      toolDescriptionKeywords: ['file', 'directory', 'folder', 'filesystem', 'path', 'create', 'write', 'read', 'list']
    },
    terminal: {
      keywords: ['command', 'execute', 'run', 'terminal', 'shell', 'bash', 'script'],
      toolDescriptionKeywords: ['command', 'execute', 'terminal', 'shell', 'session', 'run']
    },
    system: {
      keywords: ['system', 'process', 'status', 'info', 'monitor', 'snapshot'],
      toolDescriptionKeywords: ['system', 'process', 'status', 'monitor', 'snapshot', 'info']
    },
    web: {
      keywords: ['web', 'http', 'api', 'request', 'url', 'fetch', 'search'],
      toolDescriptionKeywords: ['web', 'http', 'api', 'request', 'url', 'fetch', 'search', 'browser']
    },
    communication: {
      keywords: ['send', 'message', 'email', 'notification', 'slack', 'discord'],
      toolDescriptionKeywords: ['send', 'message', 'email', 'notification', 'slack', 'discord', 'communicate']
    }
  }

  // Check which patterns match the transcript
  const matchedCapabilities: string[] = []

  for (const [capability, pattern] of Object.entries(patterns)) {
    const hasKeyword = pattern.keywords.some(keyword => transcriptLower.includes(keyword))

    // Find tools that match this capability based on their descriptions
    const capabilityTools = availableTools.filter(tool => {
      const toolNameLower = tool.name.toLowerCase()
      const toolDescLower = tool.description.toLowerCase()

      return pattern.toolDescriptionKeywords.some(keyword =>
        toolNameLower.includes(keyword) || toolDescLower.includes(keyword)
      )
    })

    if (hasKeyword && capabilityTools.length > 0) {
      matchedCapabilities.push(capability)
      relevantTools.push(...capabilityTools)
    }
  }

  let summary = ""
  if (matchedCapabilities.length > 0) {
    summary = `Detected ${matchedCapabilities.join(', ')} capabilities. Can help with this request using available tools.`
  } else {
    summary = "Analyzing available tools for potential solutions."
  }

  // Remove duplicates from relevant tools
  const uniqueRelevantTools = relevantTools.filter((tool, index, self) =>
    index === self.findIndex(t => t.name === tool.name)
  )

  return { summary, relevantTools: uniqueRelevantTools }
}

export async function processTranscriptWithAgentMode(
  transcript: string,
  availableTools: MCPTool[],
  executeToolCall: (toolCall: MCPToolCall) => Promise<MCPToolResult>,
  maxIterations: number = 10,
  previousConversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>
): Promise<AgentModeResponse> {
  const config = configStore.get()

  if (!config.mcpToolsEnabled || !config.mcpAgentModeEnabled) {
    const fallbackResponse = await processTranscriptWithTools(transcript, availableTools)
    return {
      content: fallbackResponse.content || "",
      conversationHistory: [
        { role: "user", content: transcript },
        { role: "assistant", content: fallbackResponse.content || "" }
      ],
      totalIterations: 1
    }
  }

  console.log("[MCP-AGENT] 🤖 Starting agent mode processing...")

  // Initialize progress tracking
  const progressSteps: AgentProgressStep[] = []

  // Add initial step
  const initialStep = createProgressStep("thinking", "Analyzing request", "Processing your request and determining next steps", "in_progress")
  progressSteps.push(initialStep)

  // Analyze available tool capabilities
  const toolCapabilities = analyzeToolCapabilities(availableTools, transcript)

  // Update initial step with tool analysis
  initialStep.status = "completed"
  initialStep.description = `Found ${availableTools.length} available tools. ${toolCapabilities.summary}`

  // Emit initial progress
  emitAgentProgress({
    currentIteration: 0,
    maxIterations,
    steps: progressSteps.slice(-3), // Show max 3 steps
    isComplete: false
  })

  // Enhanced system prompt for agent mode
  const baseSystemPrompt = config.mcpToolsSystemPrompt || `You are a helpful assistant that can execute tools based on user requests. You are operating in agent mode, which means you can see the results of tool executions and make follow-up tool calls as needed.

CONTEXT AWARENESS:
- Maintain awareness of files created, modified, or referenced in previous operations
- When asked to read "the file" or "that file", refer to the most recently created or mentioned file
- Remember session IDs from terminal operations to reuse them when appropriate
- Build upon previous actions rather than starting from scratch`

  // Generate dynamic tool information including schemas
  const generateToolInfo = (tools: MCPTool[]) => {
    return tools.map(tool => {
      let info = `- ${tool.name}: ${tool.description}`

      // Add parameter schema if available
      if (tool.inputSchema && tool.inputSchema.properties) {
        const params = Object.entries(tool.inputSchema.properties)
          .map(([key, schema]: [string, any]) => {
            const type = schema.type || 'any'
            const required = tool.inputSchema.required?.includes(key) ? ' (required)' : ''
            return `${key}: ${type}${required}`
          })
          .join(', ')

        if (params) {
          info += `\n  Parameters: {${params}}`
        }
      }

      return info
    }).join('\n')
  }

  // Remove duplicates from available tools to prevent confusion
  const uniqueAvailableTools = availableTools.filter((tool, index, self) =>
    index === self.findIndex(t => t.name === tool.name)
  )

  // Always inject available tools into the system prompt
  const toolsList = uniqueAvailableTools.length > 0 ? `

Available tools:
${generateToolInfo(uniqueAvailableTools)}

${toolCapabilities.relevantTools.length > 0 && toolCapabilities.relevantTools.length < uniqueAvailableTools.length ? `
MOST RELEVANT TOOLS FOR THIS REQUEST:
${generateToolInfo(toolCapabilities.relevantTools)}
` : ''}` : '\n\nNo tools are currently available.'

  const systemPrompt = baseSystemPrompt + toolsList + `

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.

CRITICAL: When calling tools, you MUST use the EXACT tool name as listed above, including any server prefixes (like "server:tool_name"). Do not modify or shorten the tool names. NEVER invent or hallucinate tool names that are not in the list above.

TOOL USAGE PATTERNS:
- Use the exact tool names as listed above, including any server prefixes
- Follow the parameter schemas provided by each tool's inputSchema
- When in doubt about parameters, prefer camelCase over snake_case naming

PARAMETER NAMING GUIDELINES:
- Different MCP servers may use different parameter naming conventions
- Common patterns: camelCase (sessionId), snake_case (session_id), kebab-case (session-id)
- If a tool call fails due to parameter naming, the system will automatically retry with corrected parameters
- Always use the exact parameter names specified in the tool's schema

ALWAYS prefer using available tools over suggesting manual approaches. If you can accomplish the task with the available tools, do it!

In agent mode, you can:
1. Execute tools and see their results
2. Make follow-up tool calls based on the results
3. Continue until the task is complete

When you need to use tools and expect to continue working after seeing the results, respond with:
{
  "toolCalls": [
    {
      "name": "exact_tool_name_from_list_above",
      "arguments": { "param1": "value1", "param2": "value2" }
    }
  ],
  "content": "Brief explanation of what you're doing",
  "needsMoreWork": true
}

When you need to use tools and the task will be complete after executing them, respond with:
{
  "toolCalls": [
    {
      "name": "exact_tool_name_from_list_above",
      "arguments": { "param1": "value1", "param2": "value2" }
    }
  ],
  "content": "Brief explanation of what you're doing",
  "needsMoreWork": false
}

When the task is complete and no more tools are needed, respond with:
{
  "content": "Final response with task completion summary",
  "needsMoreWork": false
}

If no tools are needed for the initial request, respond with:
{
  "content": "Your response text here",
  "needsMoreWork": false
}

Remember: Respond with ONLY the JSON object, no markdown formatting, no code blocks, no additional text.

CRITICAL JSON FORMATTING RULES:
- Always escape special characters in JSON strings (newlines as \\n, quotes as \\\", backslashes as \\\\)
- Never include unescaped newlines, tabs, or control characters in JSON string values
- If you need to include multi-line text or commands, use \\n for line breaks
- Always use double quotes for JSON strings, never single quotes
- Ensure all JSON is properly closed with matching braces and brackets
- Test your JSON mentally before responding to ensure it's valid`

  // Debug: Log the system prompt being used
  // console.log("[MCP-AGENT-DEBUG] 📝 Using custom system prompt:", !!config.mcpToolsSystemPrompt)
  // console.log("[MCP-AGENT-DEBUG] 📝 Full system prompt:")
  // console.log(systemPrompt)
  // console.log("[MCP-AGENT-DEBUG] 📝 System prompt length:", systemPrompt.length)
  console.log("[MCP-AGENT-DEBUG] 🔧 Available tools:", availableTools.map(t => t.name).join(", "))
  console.log("[MCP-AGENT-DEBUG] 🎯 Tool capabilities:", toolCapabilities.summary)

  // Generic context extraction from chat history - works with any MCP tool
  const extractRecentContext = (history: Array<{ role: string; content: string; toolCalls?: any[]; toolResults?: any[] }>) => {
    // Simply return the recent conversation history - let the LLM understand the context
    // This is much simpler and works with any MCP tool, not just specific ones
    return history.slice(-8) // Last 8 messages provide sufficient context
  }





  const conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }> = [
    ...(previousConversationHistory || []),
    { role: "user", content: transcript }
  ]

  // Get recent context for the LLM - no specific extraction needed
  const recentContext = extractRecentContext(conversationHistory)

  // Log context for debugging
  if (previousConversationHistory) {
    console.log(`[MCP-AGENT-DEBUG] 📚 Loaded ${previousConversationHistory.length} previous messages from conversation`)
    console.log(`[MCP-AGENT-DEBUG] 📋 Using ${recentContext.length} recent messages for context`)
  }

  let iteration = 0
  let finalContent = ""

  while (iteration < maxIterations) {
    iteration++
    console.log(`[MCP-AGENT] 🔄 Agent iteration ${iteration}/${maxIterations}`)

    // Update initial step to completed and add thinking step for this iteration
    if (iteration === 1) {
      initialStep.status = "completed"
    }

    const thinkingStep = createProgressStep(
      "thinking",
      `Planning step ${iteration}`,
      "Analyzing context and determining next actions",
      "in_progress"
    )
    progressSteps.push(thinkingStep)

    // Emit progress update
    emitAgentProgress({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: false
    })

    // Use the base system prompt - let the LLM understand context from conversation history
    let contextAwarePrompt = systemPrompt

    // Add enhanced context instruction using LLM-based context extraction
    if (recentContext.length > 1) {
      // Use LLM to extract useful context from conversation history
      const contextInfo = await extractContextFromHistory(conversationHistory, config)

      contextAwarePrompt += `\n\nCONTEXT AWARENESS:
You have access to the recent conversation history. Use this history to understand:
- Any resources (sessions, files, connections, etc.) that were created or mentioned
- Previous tool calls and their results
- User preferences and workflow patterns
- Any ongoing tasks or processes

${contextInfo.contextSummary ? `
CURRENT CONTEXT:
${contextInfo.contextSummary}
` : ''}

${contextInfo.resources.length > 0 ? `
AVAILABLE RESOURCES:
${contextInfo.resources.map(r => `- ${r.type.toUpperCase()}: ${r.id} (use as parameter: ${r.parameter})`).join('\n')}

CRITICAL: When using tools that require resource IDs, you MUST use the exact resource IDs listed above.
DO NOT create fictional or made-up resource identifiers.
` : ''}

RESOURCE USAGE GUIDELINES:
- Always check the conversation history for existing resource IDs before creating new ones
- Use the exact resource ID values provided above
- Match the resource ID to the correct parameter name as specified
- If no suitable resource is available, create a new one using the appropriate creation tool first

NEVER invent resource IDs like "my-session-123" or "temp-connection-id".
Always use actual resource IDs from the conversation history or create new ones properly.`
    }

    // Build messages for LLM call
    const messages = [
      { role: "system", content: contextAwarePrompt },
      ...conversationHistory.map(entry => {
        if (entry.role === "tool") {
          return {
            role: "user" as const,
            content: `Tool execution results:\n${entry.content}`
          }
        }
        return {
          role: entry.role as "user" | "assistant",
          content: entry.content
        }
      })
    ]

    // Make LLM call
    console.log(`[MCP-AGENT-DEBUG] 🧠 Making LLM call for iteration ${iteration}`)
    const llmResponse = await makeLLMCall(messages, config)
    console.log(`[MCP-AGENT-DEBUG] 🎯 LLM response for iteration ${iteration}:`, JSON.stringify(llmResponse, null, 2))

    // Update thinking step to completed
    thinkingStep.status = "completed"

    // Check for completion signals - only complete if there are no tools to execute
    const hasToolCalls = llmResponse.toolCalls && llmResponse.toolCalls.length > 0
    const isComplete = !hasToolCalls && (
      !llmResponse.toolCalls ||
      llmResponse.toolCalls.length === 0 ||
      (llmResponse as any).needsMoreWork === false
    )

    if (isComplete) {
      // No tools to execute or agent explicitly says it's done
      finalContent = llmResponse.content || ""
      conversationHistory.push({
        role: "assistant",
        content: finalContent
      })

      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task",
        "completed"
      )
      progressSteps.push(completionStep)

      // Emit final progress
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent
      })

      console.log(`[MCP-AGENT] ✅ Agent completed task in ${iteration} iterations`)
      break
    }

    // Execute tool calls with enhanced error handling
    console.log(`[MCP-AGENT] 🔧 Executing ${llmResponse.toolCalls!.length} tool calls`)
    const toolResults: MCPToolResult[] = []
    const failedTools: string[] = []

    for (const toolCall of llmResponse.toolCalls!) {
      console.log(`[MCP-AGENT] Executing tool: ${toolCall.name}`)

      // Add tool call step
      const toolCallStep = createProgressStep(
        "tool_call",
        `Executing ${toolCall.name}`,
        `Running tool with arguments: ${JSON.stringify(toolCall.arguments)}`,
        "in_progress"
      )
      toolCallStep.toolCall = {
        name: toolCall.name,
        arguments: toolCall.arguments
      }
      progressSteps.push(toolCallStep)

      // Emit progress update
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false
      })

      // Execute tool with retry logic for transient failures
      let result = await executeToolCall(toolCall)
      let retryCount = 0
      const maxRetries = 2

      // Enhanced retry logic for specific error types
      while (result.isError && retryCount < maxRetries) {
        const errorText = result.content.map(c => c.text).join(' ').toLowerCase()

        // Check if this is a retryable error
        const isRetryableError =
          errorText.includes('timeout') ||
          errorText.includes('connection') ||
          errorText.includes('network') ||
          errorText.includes('temporary') ||
          errorText.includes('busy') ||
          errorText.includes('session not found') // Add session errors as retryable

        if (isRetryableError) {
          retryCount++
          console.log(`[MCP-AGENT] 🔄 Retrying tool ${toolCall.name} (attempt ${retryCount}/${maxRetries})`)

          // Special handling for resource-related errors
          if (errorText.includes('not found') || errorText.includes('invalid') || errorText.includes('expired')) {
            console.log(`[MCP-AGENT] 🔧 Resource error detected, attempting recovery`)

            // The retry mechanism will benefit from the updated context extraction
            // which will provide the correct resource IDs from conversation history
            console.log(`[MCP-AGENT] 🔄 Resource error detected, relying on context extraction for recovery`)
          }

          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000))

          result = await executeToolCall(toolCall)
        } else {
          break // Don't retry non-transient errors
        }
      }

      toolResults.push(result)

      // Track failed tools for better error reporting
      if (result.isError) {
        failedTools.push(toolCall.name)
      }

      // Context is now extracted from conversation history, no need to track manually

      // Update tool call step with result
      toolCallStep.status = result.isError ? "error" : "completed"
      toolCallStep.toolResult = {
        success: !result.isError,
        content: result.content.map(c => c.text).join('\n'),
        error: result.isError ? result.content.map(c => c.text).join('\n') : undefined
      }

      // Add tool result step with enhanced error information
      const toolResultStep = createProgressStep(
        "tool_result",
        `${toolCall.name} ${result.isError ? 'failed' : 'completed'}`,
        result.isError
          ? `Tool execution failed${retryCount > 0 ? ` after ${retryCount} retries` : ''}`
          : 'Tool executed successfully',
        result.isError ? "error" : "completed"
      )
      toolResultStep.toolResult = toolCallStep.toolResult
      progressSteps.push(toolResultStep)

      // Emit progress update
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false
      })
    }

    // Add assistant response and tool results to conversation
    conversationHistory.push({
      role: "assistant",
      content: llmResponse.content || "",
      toolCalls: llmResponse.toolCalls!
    })

    const toolResultsText = toolResults.map(result =>
      result.content.map(c => c.text).join('\n')
    ).join('\n\n')

    conversationHistory.push({
      role: "tool",
      content: toolResultsText,
      toolResults
    })

    // Enhanced completion detection with better error handling
    const hasErrors = toolResults.some(result => result.isError)
    const allToolsSuccessful = toolResults.length > 0 && !hasErrors

    if (hasErrors) {
      console.log(`[MCP-AGENT] ⚠️ Tool execution had errors: ${failedTools.join(', ')}`)

      // Enhanced error analysis and recovery suggestions
      const errorAnalysis = analyzeToolErrors(toolResults, failedTools, llmResponse.toolCalls || [])

      // Add detailed error summary to conversation history for LLM context
      const errorSummary = `Tool execution errors occurred:
${failedTools.map(toolName => {
  const failedResult = toolResults.find(r => r.isError)
  const errorText = failedResult?.content.map(c => c.text).join(' ') || 'Unknown error'

  // Check for specific error patterns and suggest fixes
  let suggestion = ''
  if (errorText.includes('Session not found')) {
    suggestion = ' (Suggestion: Create a new session using ht_create_session first)'
  } else if (errorText.includes('timeout') || errorText.includes('connection')) {
    suggestion = ' (Suggestion: Retry the operation or check server connectivity)'
  } else if (errorText.includes('permission') || errorText.includes('access')) {
    suggestion = ' (Suggestion: Check file permissions or use alternative approach)'
  }

  return `- ${toolName}: ${errorText}${suggestion}`
}).join('\n')}

${errorAnalysis.recoveryStrategy}

IMPORTANT: If you see session-related errors, you MUST create a new session first using ht_create_session,
then extract the session ID from the response and use it in subsequent tool calls.

Please try alternative approaches or provide manual instructions to the user.`

      conversationHistory.push({
        role: "tool",
        content: errorSummary
      })
    }

    // Check if agent indicated it was done after executing tools
    const agentIndicatedDone = (llmResponse as any).needsMoreWork === false

    if (agentIndicatedDone && allToolsSuccessful) {
      console.log(`[MCP-AGENT] 🎯 Agent indicated task completion and tools executed successfully`)

      // Create final content that includes tool results
      const toolResultsSummary = toolResults
        .filter(result => !result.isError)
        .map(result => result.content.map(c => c.text).join('\n'))
        .join('\n\n')

      finalContent = toolResultsSummary || llmResponse.content || ""

      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task with tool results",
        "completed"
      )
      progressSteps.push(completionStep)

      // Emit final progress
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent
      })

      console.log(`[MCP-AGENT] ✅ Agent completed task in ${iteration} iterations`)
      break
    }

    // Check for completion keywords in the response
    const completionKeywords = ['completed', 'finished', 'done', 'success', 'created successfully', 'task complete']
    const responseText = (llmResponse.content || "").toLowerCase()
    const hasCompletionKeywords = completionKeywords.some(keyword => responseText.includes(keyword))

    if (allToolsSuccessful && hasCompletionKeywords) {
      console.log(`[MCP-AGENT] 🎯 Detected task completion signals - tools successful and completion keywords found`)
    }

    // Set final content to the latest assistant response (fallback)
    if (!finalContent) {
      finalContent = llmResponse.content || ""
    }
  }

  if (iteration >= maxIterations) {
    console.log(`[MCP-AGENT] ⚠️ Agent reached maximum iterations (${maxIterations})`)

    // Provide better feedback based on what happened
    const hasRecentErrors = progressSteps.slice(-5).some(step => step.status === "error")
    const errorMessage = hasRecentErrors
      ? "\n\n(Note: Task incomplete due to repeated tool failures. Please try again or use alternative methods.)"
      : "\n\n(Note: Task may not be fully complete - reached maximum iteration limit. The agent was still working on the request.)"

    finalContent += errorMessage

    // Add timeout completion step with better context
    const timeoutStep = createProgressStep(
      "completion",
      "Maximum iterations reached",
      hasRecentErrors
        ? "Task stopped due to repeated tool failures"
        : "Task stopped due to iteration limit",
      "error"
    )
    progressSteps.push(timeoutStep)

    // Emit final progress
    emitAgentProgress({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: true,
      finalContent
    })
  }

  return {
    content: finalContent,
    conversationHistory,
    totalIterations: iteration
  }
}

async function makeLLMCall(messages: Array<{role: string, content: string}>, config: any): Promise<LLMToolCallResponse> {
  const chatProviderId = config.mcpToolsProviderId

  if (chatProviderId === "gemini") {
    const geminiModel = config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    console.log("[MCP-LLM-DEBUG] 🤖 Using Gemini model:", geminiModel)
    if (!config.geminiApiKey) throw new Error("Gemini API key is required")

    const gai = new GoogleGenerativeAI(config.geminiApiKey)
    const gModel = gai.getGenerativeModel({ model: geminiModel })

    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n')

    console.log("[MCP-LLM-DEBUG] 📤 Sending request to Gemini...")
    try {
      const result = await gModel.generateContent([prompt], {
        baseUrl: config.geminiBaseUrl,
      })

      const responseText = result.response.text().trim()
      console.log("[MCP-LLM-DEBUG] 📥 Raw Gemini response:", responseText)

      const parsed = extractAndParseJSON(responseText)
      console.log("[MCP-LLM-DEBUG] 🔍 Parsed response:", parsed ? "SUCCESS" : "FAILED")
      if (parsed) {
        console.log("[MCP-LLM-DEBUG] ✅ Parsed JSON:", JSON.stringify(parsed, null, 2))
        return parsed
      } else {
        console.log("[MCP-LLM-DEBUG] ⚠️ Fallback to content response")
        diagnosticsService.logWarning('llm', 'Failed to parse Gemini response as JSON', { responseText })
        return { content: responseText }
      }
    } catch (error) {
      diagnosticsService.logError('llm', 'Gemini API call failed', error)
      throw error
    }
  }

  const chatBaseUrl =
    chatProviderId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const model = chatProviderId === "groq"
    ? config.mcpToolsGroqModel || "gemma2-9b-it"
    : config.mcpToolsOpenaiModel || "gpt-4o-mini"

  const requestBody = {
    temperature: 0,
    model,
    messages,
  }
  console.log("[MCP-LLM-DEBUG] 📋 Request body:", JSON.stringify(requestBody, null, 2))

  const chatResponse = await fetch(`${chatBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })

  console.log("[MCP-LLM-DEBUG] 📊 Response status:", chatResponse.status, chatResponse.statusText)

  if (!chatResponse.ok) {
    const errorText = await chatResponse.text()
    console.log("[MCP-LLM-DEBUG] ❌ Error response:", errorText)
    const message = `${chatResponse.statusText} ${errorText.slice(0, 300)}`
    throw new Error(message)
  }

  const chatJson = await chatResponse.json()
  const responseContent = chatJson.choices[0].message.content.trim()
  console.log("[MCP-LLM-DEBUG] 📝 Response content:", responseContent)

  const parsed = extractAndParseJSON(responseContent)
  console.log("[MCP-LLM-DEBUG] 🔍 Parsed response:", parsed ? "SUCCESS" : "FAILED")
  if (parsed) {
    console.log("[MCP-LLM-DEBUG] ✅ Parsed JSON:", JSON.stringify(parsed, null, 2))
    return parsed
  } else {
    console.log("[MCP-LLM-DEBUG] ⚠️ Fallback to content response")
    return { content: responseContent }
  }
}
