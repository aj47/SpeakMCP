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
  const baseSystemPrompt = config.mcpToolsSystemPrompt || `You are a helpful assistant that can execute tools based on user requests.`

  // Always inject available tools into the system prompt
  const toolsList = availableTools.length > 0 ? `

Available tools:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}` : '\n\nNo tools are currently available.'

  const systemPrompt = baseSystemPrompt + toolsList + `

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.

CRITICAL: When calling tools, you MUST use the EXACT tool name as listed above, including any server prefixes (like "server:tool_name"). Do not modify or shorten the tool names. NEVER invent or hallucinate tool names that are not in the list above.

TOOL USAGE PATTERNS:
For file system operations (like listing directories, checking desktop contents):
1. Use "Headless Terminal:ht_create_session" to create a terminal session
2. Use "Headless Terminal:ht_execute_command" with commands like "ls ~/Desktop", "ls -la /path/to/directory", "pwd", etc.

For web operations:
- Use any available web/search tools if present in the list above

For system operations:
- Use terminal commands via "Headless Terminal:ht_execute_command" for system tasks

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

  // Define capability patterns (handle tool name prefixes)
  const patterns = {
    filesystem: {
      keywords: ['file', 'directory', 'folder', 'desktop', 'list', 'ls', 'contents', 'browse'],
      tools: ['ht_create_session', 'ht_execute_command']
    },
    terminal: {
      keywords: ['command', 'execute', 'run', 'terminal', 'shell', 'bash'],
      tools: ['ht_create_session', 'ht_execute_command', 'ht_send_keys']
    },
    system: {
      keywords: ['system', 'process', 'status', 'info'],
      tools: ['ht_execute_command', 'ht_take_snapshot']
    }
  }

  // Check which patterns match the transcript
  const matchedCapabilities: string[] = []

  for (const [capability, pattern] of Object.entries(patterns)) {
    const hasKeyword = pattern.keywords.some(keyword => transcriptLower.includes(keyword))
    const hasTools = pattern.tools.some(toolName =>
      availableTools.some(tool => tool.name.includes(toolName))
    )

    if (hasKeyword && hasTools) {
      matchedCapabilities.push(capability)
      // Add relevant tools (match by tool name suffix, handling prefixes)
      pattern.tools.forEach(toolName => {
        const tool = availableTools.find(t => t.name.includes(toolName))
        if (tool && !relevantTools.includes(tool)) {
          relevantTools.push(tool)
        }
      })
    }
  }

  let summary = ""
  if (matchedCapabilities.length > 0) {
    summary = `Detected ${matchedCapabilities.join(', ')} capabilities. Can help with this request using terminal tools.`
  } else {
    summary = "Analyzing available tools for potential solutions."
  }

  return { summary, relevantTools }
}

export async function processTranscriptWithAgentMode(
  transcript: string,
  availableTools: MCPTool[],
  executeToolCall: (toolCall: MCPToolCall) => Promise<MCPToolResult>,
  maxIterations: number = 10
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
  const baseSystemPrompt = config.mcpToolsSystemPrompt || `You are a helpful assistant that can execute tools based on user requests. You are operating in agent mode, which means you can see the results of tool executions and make follow-up tool calls as needed.`

  // Always inject available tools into the system prompt
  const toolsList = availableTools.length > 0 ? `

Available tools:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

${toolCapabilities.relevantTools.length > 0 ? `
RELEVANT TOOLS FOR THIS REQUEST:
${toolCapabilities.relevantTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}
` : ''}` : '\n\nNo tools are currently available.'

  const systemPrompt = baseSystemPrompt + toolsList + `

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.

CRITICAL: When calling tools, you MUST use the EXACT tool name as listed above, including any server prefixes (like "server:tool_name"). Do not modify or shorten the tool names. NEVER invent or hallucinate tool names that are not in the list above.

TOOL USAGE PATTERNS:
For file system operations (like listing directories, checking desktop contents):
1. Use "Headless Terminal:ht_create_session" to create a terminal session
2. Use "Headless Terminal:ht_execute_command" with commands like "ls ~/Desktop", "ls -la /path/to/directory", "pwd", etc.

For web operations:
- Use any available web/search tools if present in the list above

For system operations:
- Use terminal commands via "Headless Terminal:ht_execute_command" for system tasks

ALWAYS prefer using available tools over suggesting manual approaches. If you can accomplish the task with the available tools, do it!

In agent mode, you can:
1. Execute tools and see their results
2. Make follow-up tool calls based on the results
3. Continue until the task is complete

When you need to use tools, respond with this exact JSON format:
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

  const conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }> = [
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

    // Build messages for LLM call
    const messages = [
      { role: "system", content: systemPrompt },
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

    // Check for completion signals
    const isComplete = !llmResponse.toolCalls ||
                      llmResponse.toolCalls.length === 0 ||
                      (llmResponse as any).needsMoreWork === false

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

    // Execute tool calls
    console.log(`[MCP-AGENT] 🔧 Executing ${llmResponse.toolCalls!.length} tool calls`)
    const toolResults: MCPToolResult[] = []

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

      const result = await executeToolCall(toolCall)
      toolResults.push(result)

      // Update tool call step with result
      toolCallStep.status = result.isError ? "error" : "completed"
      toolCallStep.toolResult = {
        success: !result.isError,
        content: result.content.map(c => c.text).join('\n'),
        error: result.isError ? result.content.map(c => c.text).join('\n') : undefined
      }

      // Add tool result step
      const toolResultStep = createProgressStep(
        "tool_result",
        `${toolCall.name} ${result.isError ? 'failed' : 'completed'}`,
        result.isError ? 'Tool execution failed' : 'Tool executed successfully',
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

    // Enhanced completion detection
    const hasErrors = toolResults.some(result => result.isError)
    const allToolsSuccessful = toolResults.length > 0 && !hasErrors

    if (hasErrors) {
      console.log(`[MCP-AGENT] ⚠️ Tool execution had errors, continuing to handle them`)
    }

    // Check for completion keywords in the response
    const completionKeywords = ['completed', 'finished', 'done', 'success', 'created successfully', 'task complete']
    const responseText = (llmResponse.content || "").toLowerCase()
    const hasCompletionKeywords = completionKeywords.some(keyword => responseText.includes(keyword))

    if (allToolsSuccessful && hasCompletionKeywords) {
      console.log(`[MCP-AGENT] 🎯 Detected task completion signals - tools successful and completion keywords found`)
    }

    // Set final content to the latest assistant response
    finalContent = llmResponse.content || ""
  }

  if (iteration >= maxIterations) {
    console.log(`[MCP-AGENT] ⚠️ Agent reached maximum iterations (${maxIterations})`)
    finalContent += "\n\n(Note: Task may not be fully complete - reached maximum iteration limit)"

    // Add timeout completion step
    const timeoutStep = createProgressStep(
      "completion",
      "Maximum iterations reached",
      "Task stopped due to iteration limit",
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

  // Debug: Log LLM call details
  console.log("[MCP-LLM-DEBUG] 🚀 Making LLM call")
  console.log("[MCP-LLM-DEBUG] 🔧 Provider:", chatProviderId || "openai (default)")
  console.log("[MCP-LLM-DEBUG] 📝 Messages count:", messages.length)
  console.log("[MCP-LLM-DEBUG] 📋 Messages preview:")
  messages.forEach((msg, i) => {
    const preview = msg.content.length > 200 ? msg.content.substring(0, 200) + "..." : msg.content
    console.log(`[MCP-LLM-DEBUG]   ${i + 1}. ${msg.role}: ${preview}`)
  })

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

  console.log("[MCP-LLM-DEBUG] 🤖 Using model:", model)
  console.log("[MCP-LLM-DEBUG] 🌐 Base URL:", chatBaseUrl)
  console.log("[MCP-LLM-DEBUG] 📤 Sending request to", chatProviderId === "groq" ? "Groq" : "OpenAI", "...")

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
  console.log("[MCP-LLM-DEBUG] 📥 Full response JSON:", JSON.stringify(chatJson, null, 2))

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
