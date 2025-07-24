import { GoogleGenerativeAI } from "@google/generative-ai"
import { configStore } from "./config"
import { MCPTool, MCPToolCall, LLMToolCallResponse, MCPToolResult } from "./mcp-service"
import { AgentProgressStep, AgentProgressUpdate } from "../shared/types"
import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow } from "./window"
import { RendererHandlers } from "./renderer-handlers"

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
  console.log("[JSON-PARSER] 🔍 Attempting to parse response:", responseText.substring(0, 200) + (responseText.length > 200 ? "..." : ""))

  // First, try direct JSON parsing
  try {
    const parsed = JSON.parse(responseText.trim())
    if (isValidLLMResponse(parsed)) {
      console.log("[JSON-PARSER] ✅ Direct JSON parsing successful")
      return parsed
    }
  } catch (error) {
    console.log("[JSON-PARSER] ❌ Direct JSON parsing failed:", error instanceof Error ? error.message : String(error))
  }

  // Try to extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi
  let match = codeBlockRegex.exec(responseText)

  if (match) {
    console.log("[JSON-PARSER] 📋 Found JSON in code block")
    try {
      const parsed = JSON.parse(match[1].trim())
      if (isValidLLMResponse(parsed)) {
        console.log("[JSON-PARSER] ✅ Code block JSON parsing successful")
        return parsed
      }
    } catch (error) {
      console.log("[JSON-PARSER] ❌ Code block JSON parsing failed:", error instanceof Error ? error.message : String(error))
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

      try {
        const parsed = JSON.parse(potentialJson.trim())
        if (isValidLLMResponse(parsed)) {
          console.log("[JSON-PARSER] ✅ Successfully parsed JSON object", i + 1)
          return parsed
        } else {
          console.log("[JSON-PARSER] ❌ JSON object", i + 1, "failed validation")
        }
      } catch (error) {
        console.log("[JSON-PARSER] ❌ JSON object", i + 1, "parsing failed:", error instanceof Error ? error.message : String(error))
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

Remember: Respond with ONLY the JSON object, no markdown formatting, no code blocks, no additional text.`

  // Debug: Log the system prompt being used
  console.log("[MCP-AGENT-DEBUG] 📝 Using custom system prompt:", !!config.mcpToolsSystemPrompt)
  console.log("[MCP-AGENT-DEBUG] 📝 Full system prompt:")
  console.log(systemPrompt)
  console.log("[MCP-AGENT-DEBUG] 📝 System prompt length:", systemPrompt.length)
  console.log("[MCP-AGENT-DEBUG] 🔧 Available tools:", availableTools.map(t => t.name).join(", "))
  console.log("[MCP-AGENT-DEBUG] 🎯 Tool capabilities:", toolCapabilities.summary)

  // Track context across the conversation
  const contextTracker = {
    createdFiles: [] as string[],
    sessionIds: new Map<string, string>(), // server -> sessionId
    lastMentionedFile: null as string | null,
    recentOperations: [] as Array<{ tool: string; operation: string; timestamp: number }>
  }

  // Initialize context from previous conversation history
  if (previousConversationHistory) {
    for (const message of previousConversationHistory) {
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          // Extract file paths from tool arguments
          if (toolCall.arguments) {
            const argString = JSON.stringify(toolCall.arguments)
            const filePatterns = [
              /([~\/][\w\/-]*\.\w+)/g, // Unix-style paths with extensions
              /([A-Z]:\\[\w\\-]*\.\w+)/g, // Windows-style paths with extensions
            ]

            for (const pattern of filePatterns) {
              const matches = argString.match(pattern)
              if (matches) {
                matches.forEach(filePath => {
                  if (!contextTracker.createdFiles.includes(filePath)) {
                    contextTracker.createdFiles.push(filePath)
                    contextTracker.lastMentionedFile = filePath
                  }
                })
              }
            }
          }

          // Track operations
          contextTracker.recentOperations.push({
            tool: toolCall.name,
            operation: 'completed', // Assume completed from history
            timestamp: Date.now() - (60000 * contextTracker.recentOperations.length) // Stagger timestamps
          })
        }
      }

      // Look for file mentions in message content
      if (message.content) {
        const filePatterns = [
          /([~\/][\w\/-]*\.\w+)/g, // Unix-style paths with extensions
          /([A-Z]:\\[\w\\-]*\.\w+)/g, // Windows-style paths with extensions
          /Desktop\/[\w\-_]+\.[\w]+/g, // Desktop files
        ]

        for (const pattern of filePatterns) {
          const matches = message.content.match(pattern)
          if (matches) {
            matches.forEach(filePath => {
              if (!contextTracker.createdFiles.includes(filePath)) {
                contextTracker.createdFiles.push(filePath)
                contextTracker.lastMentionedFile = filePath
              }
            })
          }
        }

        // Extract session IDs from message content
        const sessionPatterns = [
          /Session ID: ([a-f0-9-]+)/i,
          /session[_-]?id[:\s]+([a-f0-9-]+)/i,
          /id[:\s]+([a-f0-9-]+)/i
        ]

        for (const pattern of sessionPatterns) {
          const match = message.content.match(pattern)
          if (match && match[1]) {
            // Try to determine server name from context
            const serverName = 'Headless Terminal' // Default for now
            contextTracker.sessionIds.set(serverName, match[1])
            break
          }
        }
      }
    }

    console.log(`[MCP-AGENT-DEBUG] 📚 Initialized context from ${previousConversationHistory.length} previous messages:`)
    console.log(`[MCP-AGENT-DEBUG]   - Created files: ${contextTracker.createdFiles.length}`)
    console.log(`[MCP-AGENT-DEBUG]   - Active sessions: ${contextTracker.sessionIds.size}`)
    console.log(`[MCP-AGENT-DEBUG]   - Recent operations: ${contextTracker.recentOperations.length}`)
    if (contextTracker.lastMentionedFile) {
      console.log(`[MCP-AGENT-DEBUG]   - Last mentioned file: ${contextTracker.lastMentionedFile}`)
    }
  }

  // Helper function to update context based on tool calls and results
  const updateContext = (toolCall: MCPToolCall, result: MCPToolResult) => {
    const timestamp = Date.now()

    // Extract server name from tool name
    const [serverName] = toolCall.name.split(':')

    // Generic session ID tracking - look for common session ID patterns in results
    if (!result.isError && result.content[0]?.text) {
      const text = result.content[0].text

      // Common session ID patterns
      const sessionPatterns = [
        /Session ID: ([a-f0-9-]+)/i,
        /session[_-]?id[:\s]+([a-f0-9-]+)/i,
        /id[:\s]+([a-f0-9-]+)/i
      ]

      for (const pattern of sessionPatterns) {
        const match = text.match(pattern)
        if (match && match[1]) {
          contextTracker.sessionIds.set(serverName, match[1])
          break
        }
      }
    }

    // Generic file tracking - look for file paths in arguments and results
    const trackFileOperations = () => {
      // Check arguments for file paths
      if (toolCall.arguments) {
        const argString = JSON.stringify(toolCall.arguments)
        const filePatterns = [
          /([~\/][\w\/-]*\.\w+)/g, // Unix-style paths with extensions
          /([A-Z]:\\[\w\\-]*\.\w+)/g, // Windows-style paths with extensions
        ]

        for (const pattern of filePatterns) {
          const matches = argString.match(pattern)
          if (matches) {
            matches.forEach(filePath => {
              if (!contextTracker.createdFiles.includes(filePath)) {
                contextTracker.createdFiles.push(filePath)
                contextTracker.lastMentionedFile = filePath
              }
            })
          }
        }
      }

      // Check results for file mentions
      if (!result.isError && result.content[0]?.text) {
        const text = result.content[0].text
        const filePatterns = [
          /created?\s+([~\/][\w\/-]*\.\w+)/gi,
          /wrote\s+to\s+([~\/][\w\/-]*\.\w+)/gi,
          /saved?\s+([~\/][\w\/-]*\.\w+)/gi,
        ]

        for (const pattern of filePatterns) {
          const matches = text.match(pattern)
          if (matches) {
            matches.forEach(match => {
              const filePath = match.replace(/^(created?|wrote\s+to|saved?)\s+/i, '')
              if (!contextTracker.createdFiles.includes(filePath)) {
                contextTracker.createdFiles.push(filePath)
                contextTracker.lastMentionedFile = filePath
              }
            })
          }
        }
      }
    }

    trackFileOperations()

    // Track recent operations
    contextTracker.recentOperations.push({
      tool: toolCall.name,
      operation: result.isError ? 'failed' : 'completed',
      timestamp
    })

    // Keep only recent operations (last 10)
    if (contextTracker.recentOperations.length > 10) {
      contextTracker.recentOperations = contextTracker.recentOperations.slice(-10)
    }
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

    // Build context-aware system prompt
    let contextAwarePrompt = systemPrompt
    if (contextTracker.createdFiles.length > 0 || contextTracker.sessionIds.size > 0 || contextTracker.recentOperations.length > 0) {
      contextAwarePrompt += `\n\nCURRENT CONTEXT:`

      if (contextTracker.sessionIds.size > 0) {
        contextAwarePrompt += `\nActive sessions:`
        for (const [server, sessionId] of contextTracker.sessionIds) {
          contextAwarePrompt += `\n- ${server}: ${sessionId}`
        }
      }

      if (contextTracker.createdFiles.length > 0) {
        contextAwarePrompt += `\nRecently created/mentioned files:`
        contextTracker.createdFiles.forEach(file => {
          contextAwarePrompt += `\n- ${file}`
        })

        if (contextTracker.lastMentionedFile) {
          contextAwarePrompt += `\nMost recent file: ${contextTracker.lastMentionedFile}`
        }
      }

      if (contextTracker.recentOperations.length > 0) {
        contextAwarePrompt += `\nRecent operations:`
        contextTracker.recentOperations.slice(-5).forEach(op => {
          const timeAgo = Math.round((Date.now() - op.timestamp) / 1000)
          contextAwarePrompt += `\n- ${op.tool} (${op.operation}) ${timeAgo}s ago`
        })
      }
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

      // Retry logic for specific error types
      while (result.isError && retryCount < maxRetries) {
        const errorText = result.content.map(c => c.text).join(' ').toLowerCase()

        // Check if this is a retryable error
        const isRetryableError =
          errorText.includes('timeout') ||
          errorText.includes('connection') ||
          errorText.includes('network') ||
          errorText.includes('temporary') ||
          errorText.includes('busy')

        if (isRetryableError) {
          retryCount++
          console.log(`[MCP-AGENT] 🔄 Retrying tool ${toolCall.name} (attempt ${retryCount}/${maxRetries})`)

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

      // Update context tracking
      updateContext(toolCall, result)

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

      // Add error summary to conversation history for LLM context
      const errorSummary = `Tool execution errors occurred:
${failedTools.map(toolName => {
  const failedResult = toolResults.find(r => r.isError)
  return `- ${toolName}: ${failedResult?.content.map(c => c.text).join(' ') || 'Unknown error'}`
}).join('\n')}

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
      return { content: responseText }
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
