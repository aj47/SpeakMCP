import { MCPTool, MCPToolCall, MCPToolResult } from '../main/mcp-service'
import { AgentProgressStep, AgentProgressUpdate } from '../shared/types'

export interface MockMCPConfig {
  enabledTools: string[]
  simulateDelay: boolean
  delayRange: [number, number] // [min, max] in milliseconds
  errorRate: number // 0-1, probability of tool call failure
  enableProgressUpdates: boolean
}

export class MockMCPService {
  private config: MockMCPConfig
  private progressCallback?: (update: AgentProgressUpdate) => void

  constructor(config: Partial<MockMCPConfig> = {}) {
    this.config = {
      enabledTools: ['filesystem', 'web-search', 'calculator', 'weather', 'email', 'calendar'],
      simulateDelay: true,
      delayRange: [500, 2000],
      errorRate: 0.1,
      enableProgressUpdates: true,
      ...config
    }
  }

  public setProgressCallback(callback: (update: AgentProgressUpdate) => void) {
    this.progressCallback = callback
  }

  public async getAvailableTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = [
      {
        name: 'filesystem_read',
        description: 'Read contents of a file from the filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file to read' }
          },
          required: ['path']
        }
      },
      {
        name: 'filesystem_write',
        description: 'Write content to a file on the filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file to write' },
            content: { type: 'string', description: 'Content to write to the file' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'web_search',
        description: 'Search the web for information',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Maximum number of results', default: 10 }
          },
          required: ['query']
        }
      },
      {
        name: 'calculator',
        description: 'Perform mathematical calculations',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Mathematical expression to evaluate' }
          },
          required: ['expression']
        }
      },
      {
        name: 'weather',
        description: 'Get current weather information for a location',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'Location to get weather for' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'fahrenheit' }
          },
          required: ['location']
        }
      },
      {
        name: 'email_send',
        description: 'Send an email message',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body content' }
          },
          required: ['to', 'subject', 'body']
        }
      },
      {
        name: 'calendar_create_event',
        description: 'Create a new calendar event',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'Start date/time (ISO format)' },
            end: { type: 'string', description: 'End date/time (ISO format)' },
            description: { type: 'string', description: 'Event description' }
          },
          required: ['title', 'start', 'end']
        }
      }
    ]

    // Filter tools based on enabled tools configuration
    return allTools.filter(tool => 
      this.config.enabledTools.some(enabled => tool.name.startsWith(enabled))
    )
  }

  public async executeToolCall(toolCall: MCPToolCall): Promise<MCPToolResult> {
    // Simulate processing delay
    if (this.config.simulateDelay) {
      const [min, max] = this.config.delayRange
      const delay = Math.random() * (max - min) + min
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // Simulate random errors
    if (Math.random() < this.config.errorRate) {
      return {
        content: [{
          type: 'text',
          text: `Error executing tool ${toolCall.name}: Simulated failure`
        }],
        isError: true
      }
    }

    // Generate mock results based on tool name
    const result = this.generateMockResult(toolCall)
    return result
  }

  private generateMockResult(toolCall: MCPToolCall): MCPToolResult {
    const { name, arguments: args } = toolCall

    const mockResults: Record<string, () => string> = {
      'filesystem_read': () => {
        const mockContent = `# Mock File Content\n\nThis is mock content for file: ${args.path}\n\nGenerated at: ${new Date().toISOString()}\n\n## Sample Data\n\n\`\`\`json\n${JSON.stringify({ example: 'data', timestamp: Date.now() }, null, 2)}\n\`\`\``
        return mockContent
      },
      
      'filesystem_write': () => {
        return `Successfully wrote ${args.content?.length || 0} characters to ${args.path}`
      },
      
      'web_search': () => {
        const mockResults = [
          { title: 'Example Result 1', url: 'https://example.com/1', snippet: 'This is a mock search result for your query.' },
          { title: 'Example Result 2', url: 'https://example.com/2', snippet: 'Another mock result with relevant information.' },
          { title: 'Example Result 3', url: 'https://example.com/3', snippet: 'Third mock result showing search functionality.' }
        ]
        return `Found ${mockResults.length} results for "${args.query}":\n\n${mockResults.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n`).join('\n')}`
      },
      
      'calculator': () => {
        try {
          // Simple expression evaluation (for demo purposes - replace eval in production)
          const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '')
          const result = Function('"use strict"; return (' + sanitized + ')')()
          return `${args.expression} = ${result}`
        } catch {
          return `Error: Could not evaluate expression "${args.expression}"`
        }
      },
      
      'weather': () => {
        const conditions = ['sunny', 'cloudy', 'rainy', 'snowy', 'partly cloudy']
        const condition = conditions[Math.floor(Math.random() * conditions.length)]
        const temp = Math.floor(Math.random() * 40) + 50 // 50-90°F
        const humidity = Math.floor(Math.random() * 50) + 30 // 30-80%
        
        return `Weather in ${args.location}:\n- Condition: ${condition}\n- Temperature: ${temp}°${args.units === 'celsius' ? 'C' : 'F'}\n- Humidity: ${humidity}%\n- Wind: ${Math.floor(Math.random() * 20)} mph`
      },
      
      'email_send': () => {
        return `Email sent successfully!\n- To: ${args.to}\n- Subject: ${args.subject}\n- Body length: ${args.body?.length || 0} characters\n- Sent at: ${new Date().toLocaleString()}`
      },
      
      'calendar_create_event': () => {
        return `Calendar event created successfully!\n- Title: ${args.title}\n- Start: ${args.start}\n- End: ${args.end}\n- Description: ${args.description || 'No description'}\n- Event ID: evt_${Date.now()}`
      }
    }

    const generator = mockResults[name] || (() => `Mock result for ${name}: ${JSON.stringify(args, null, 2)}`)
    
    return {
      content: [{
        type: 'text',
        text: generator()
      }],
      isError: false
    }
  }

  public async simulateAgentMode(
    transcript: string,
    maxIterations: number = 5
  ): Promise<void> {
    if (!this.config.enableProgressUpdates || !this.progressCallback) {
      return
    }

    const steps: AgentProgressStep[] = []
    let currentIteration = 1

    // Initial thinking step
    const thinkingStep: AgentProgressStep = {
      id: `step_${Date.now()}_thinking`,
      type: 'thinking',
      title: 'Analyzing request',
      description: 'Understanding the user request and planning actions',
      status: 'in_progress',
      timestamp: Date.now(),
      llmContent: `I need to analyze this request: "${transcript}"\n\nLet me break this down and determine what tools I need to use...`
    }

    steps.push(thinkingStep)
    this.emitProgress(currentIteration, maxIterations, steps, false)

    await this.delay(1000)

    thinkingStep.status = 'completed'
    this.emitProgress(currentIteration, maxIterations, steps, false)

    // Simulate tool calls based on the transcript
    const toolsToCall = this.determineToolsFromTranscript(transcript)

    for (const toolCall of toolsToCall) {
      if (currentIteration > maxIterations) break

      // Tool call step
      const toolCallStep: AgentProgressStep = {
        id: `step_${Date.now()}_tool_${toolCall.name}`,
        type: 'tool_call',
        title: `Calling ${toolCall.name}`,
        description: `Executing ${toolCall.name} with provided arguments`,
        status: 'in_progress',
        timestamp: Date.now(),
        toolCall
      }

      steps.push(toolCallStep)
      this.emitProgress(currentIteration, maxIterations, steps, false)

      await this.delay(800)

      // Execute the tool call
      const result = await this.executeToolCall(toolCall)

      // Tool result step
      const toolResultStep: AgentProgressStep = {
        id: `step_${Date.now()}_result_${toolCall.name}`,
        type: 'tool_result',
        title: `${toolCall.name} result`,
        description: result.isError ? 'Tool execution failed' : 'Tool executed successfully',
        status: result.isError ? 'error' : 'completed',
        timestamp: Date.now(),
        toolResult: {
          success: !result.isError,
          content: result.content[0]?.text || '',
          error: result.isError ? result.content[0]?.text : undefined
        }
      }

      toolCallStep.status = 'completed'
      steps.push(toolResultStep)
      this.emitProgress(currentIteration, maxIterations, steps, false)

      currentIteration++
      await this.delay(500)
    }

    // Final completion step
    const completionStep: AgentProgressStep = {
      id: `step_${Date.now()}_completion`,
      type: 'completion',
      title: 'Task completed',
      description: 'All requested actions have been completed',
      status: 'completed',
      timestamp: Date.now()
    }

    steps.push(completionStep)
    
    const finalContent = `I've completed the requested task: "${transcript}"\n\nExecuted ${toolsToCall.length} tool calls across ${currentIteration - 1} iterations.`
    
    this.emitProgress(currentIteration, maxIterations, steps, true, finalContent)
  }

  private determineToolsFromTranscript(transcript: string): MCPToolCall[] {
    const tools: MCPToolCall[] = []
    const lowerTranscript = transcript.toLowerCase()

    // Simple keyword-based tool selection for demo
    if (lowerTranscript.includes('file') || lowerTranscript.includes('read') || lowerTranscript.includes('write')) {
      tools.push({
        name: 'filesystem_read',
        arguments: { path: '/example/file.txt' }
      })
    }

    if (lowerTranscript.includes('search') || lowerTranscript.includes('find') || lowerTranscript.includes('look up')) {
      tools.push({
        name: 'web_search',
        arguments: { query: transcript.substring(0, 50), limit: 5 }
      })
    }

    if (lowerTranscript.includes('calculate') || lowerTranscript.includes('math') || /\d+[\+\-\*\/]\d+/.test(lowerTranscript)) {
      const mathMatch = lowerTranscript.match(/(\d+[\+\-\*\/\d\s\(\)\.]+\d+)/)
      tools.push({
        name: 'calculator',
        arguments: { expression: mathMatch?.[1] || '2 + 2' }
      })
    }

    if (lowerTranscript.includes('weather')) {
      tools.push({
        name: 'weather',
        arguments: { location: 'San Francisco, CA', units: 'fahrenheit' }
      })
    }

    // Default to web search if no specific tools detected
    if (tools.length === 0) {
      tools.push({
        name: 'web_search',
        arguments: { query: transcript, limit: 3 }
      })
    }

    return tools
  }

  private emitProgress(
    currentIteration: number,
    maxIterations: number,
    steps: AgentProgressStep[],
    isComplete: boolean,
    finalContent?: string
  ) {
    if (!this.progressCallback) return

    const update: AgentProgressUpdate = {
      currentIteration,
      maxIterations,
      steps: [...steps],
      isComplete,
      finalContent
    }

    this.progressCallback(update)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  public updateConfig(config: Partial<MockMCPConfig>) {
    this.config = { ...this.config, ...config }
  }

  public getConfig(): MockMCPConfig {
    return { ...this.config }
  }
}
