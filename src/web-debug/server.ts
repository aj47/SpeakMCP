import express from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import path from 'path'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// Types for web debugging
export interface WebDebugSession {
  id: string
  name: string
  createdAt: number
  messages: WebDebugMessage[]
  toolCalls: WebDebugToolCall[]
  status: 'active' | 'completed' | 'error'
}

export interface WebDebugMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: WebDebugToolCall[]
  toolResults?: WebDebugToolResult[]
}

export interface WebDebugToolCall {
  id: string
  sessionId: string
  messageId: string
  name: string
  arguments: any
  timestamp: number
  status: 'pending' | 'executing' | 'completed' | 'error'
  duration?: number
}

export interface WebDebugToolResult {
  id: string
  toolCallId: string
  success: boolean
  content: string
  error?: string
  timestamp: number
}

export interface WebDebugConfig {
  port: number
  host: string
  enableMockTools: boolean
  mockDelay: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export class WebDebugServer {
  private app: express.Application
  private server: any
  private io: SocketIOServer
  private sessions: Map<string, WebDebugSession> = new Map()
  private config: WebDebugConfig

  constructor(config: Partial<WebDebugConfig> = {}) {
    this.config = {
      port: 3001,
      host: 'localhost',
      enableMockTools: true,
      mockDelay: 1000,
      logLevel: 'info',
      ...config
    }

    this.app = express()
    this.server = createServer(this.app)
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    })

    this.setupMiddleware()
    this.setupRoutes()
    this.setupWebSocket()
  }

  private setupMiddleware() {
    this.app.use(cors())
    this.app.use(express.json())
    this.app.use(express.static(path.join(process.cwd(), 'dist-web-debug')))
  }

  private setupRoutes() {
    // API Routes
    this.app.get('/api/sessions', (req, res) => {
      const sessions = Array.from(this.sessions.values())
      res.json(sessions)
    })

    this.app.get('/api/sessions/:sessionId', (req, res) => {
      const session = this.sessions.get(req.params.sessionId)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }
      res.json(session)
    })

    this.app.post('/api/sessions', (req, res) => {
      const { name, initialMessage } = req.body
      const session = this.createSession(name, initialMessage)
      res.json(session)
    })

    this.app.post('/api/sessions/:sessionId/messages', (req, res) => {
      const { content, role = 'user' } = req.body
      const session = this.sessions.get(req.params.sessionId)

      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const message = this.addMessage(session.id, content, role)

      // Emit to WebSocket clients
      this.io.emit('message', { sessionId: session.id, message })

      res.json(message)
    })

    this.app.post('/api/sessions/:sessionId/tool-calls', (req, res) => {
      const { name, arguments: args } = req.body
      const session = this.sessions.get(req.params.sessionId)

      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const toolCall = this.executeToolCall(session.id, name, args)
      res.json(toolCall)
    })

    this.app.delete('/api/sessions/:sessionId', (req, res) => {
      const deleted = this.sessions.delete(req.params.sessionId)
      if (!deleted) {
        return res.status(404).json({ error: 'Session not found' })
      }

      // Emit to WebSocket clients
      this.io.emit('sessionDeleted', { sessionId: req.params.sessionId })

      res.json({ success: true })
    })

    // Serve the web debugging interface
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist-web-debug', 'index.html'))
    })

    // Catch-all route for SPA
    this.app.get('*', (req, res) => {
      // Only serve index.html for non-API routes
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(process.cwd(), 'dist-web-debug', 'index.html'))
      } else {
        res.status(404).json({ error: 'API endpoint not found' })
      }
    })
  }

  private setupWebSocket() {
    this.io.on('connection', (socket) => {
      this.log('info', `Client connected: ${socket.id}`)

      socket.on('joinSession', (sessionId: string) => {
        socket.join(sessionId)
        this.log('debug', `Client ${socket.id} joined session ${sessionId}`)
      })

      socket.on('leaveSession', (sessionId: string) => {
        socket.leave(sessionId)
        this.log('debug', `Client ${socket.id} left session ${sessionId}`)
      })

      socket.on('disconnect', () => {
        this.log('info', `Client disconnected: ${socket.id}`)
      })
    })
  }

  private createSession(name: string, initialMessage?: string): WebDebugSession {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const session: WebDebugSession = {
      id,
      name,
      createdAt: Date.now(),
      messages: [],
      toolCalls: [],
      status: 'active'
    }

    if (initialMessage) {
      this.addMessage(id, initialMessage, 'user')
    }

    this.sessions.set(id, session)
    
    // Emit to WebSocket clients
    this.io.emit('sessionCreated', session)
    
    this.log('info', `Created session: ${id} (${name})`)
    return session
  }

  private addMessage(sessionId: string, content: string, role: 'user' | 'assistant' | 'tool'): WebDebugMessage {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    const message: WebDebugMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      role,
      content,
      timestamp: Date.now()
    }

    session.messages.push(message)
    this.log('debug', `Added message to session ${sessionId}: ${role} - ${content.substring(0, 50)}...`)
    
    return message
  }

  private executeToolCall(sessionId: string, name: string, args: any): WebDebugToolCall {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    const toolCall: WebDebugToolCall = {
      id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      messageId: session.messages[session.messages.length - 1]?.id || '',
      name,
      arguments: args,
      timestamp: Date.now(),
      status: 'pending'
    }

    session.toolCalls.push(toolCall)
    
    // Emit to WebSocket clients
    this.io.to(sessionId).emit('toolCall', toolCall)
    
    // Simulate tool execution if mock tools are enabled
    if (this.config.enableMockTools) {
      this.simulateToolExecution(toolCall)
    }

    this.log('info', `Executing tool call: ${name} in session ${sessionId}`)
    return toolCall
  }

  private async simulateToolExecution(toolCall: WebDebugToolCall) {
    // Update status to executing
    toolCall.status = 'executing'
    this.io.to(toolCall.sessionId).emit('toolCallUpdate', toolCall)

    // Simulate execution delay
    await new Promise(resolve => setTimeout(resolve, this.config.mockDelay))

    // Create mock result
    const result: WebDebugToolResult = {
      id: `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      toolCallId: toolCall.id,
      success: Math.random() > 0.1, // 90% success rate
      content: this.generateMockToolResult(toolCall.name, toolCall.arguments),
      timestamp: Date.now()
    }

    if (!result.success) {
      result.error = 'Mock tool execution failed'
    }

    // Update tool call status
    toolCall.status = result.success ? 'completed' : 'error'
    toolCall.duration = Date.now() - toolCall.timestamp

    // Emit results
    this.io.to(toolCall.sessionId).emit('toolCallUpdate', toolCall)
    this.io.to(toolCall.sessionId).emit('toolResult', result)

    this.log('debug', `Tool call ${toolCall.id} completed with status: ${toolCall.status}`)
  }

  private generateMockToolResult(toolName: string, args: any): string {
    const mockResults: Record<string, () => string> = {
      'filesystem_read': () => `File content: ${JSON.stringify(args, null, 2)}`,
      'filesystem_write': () => `Successfully wrote to file: ${args.path}`,
      'web_search': () => `Found 5 results for query: "${args.query}"`,
      'calculator': () => `Result: ${Math.random() * 100}`,
      'weather': () => `Weather in ${args.location}: 72°F, sunny`,
      'default': () => `Mock result for ${toolName}: ${JSON.stringify(args, null, 2)}`
    }

    const generator = mockResults[toolName] || mockResults.default
    return generator()
  }

  private log(level: string, message: string) {
    const levels = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.config.logLevel)
    const messageLevelIndex = levels.indexOf(level)

    if (messageLevelIndex >= currentLevelIndex) {
      const timestamp = new Date().toISOString()
      console.log(`[${timestamp}] [WEB-DEBUG] [${level.toUpperCase()}] ${message}`)
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.log('info', `Web debugging server started on http://${this.config.host}:${this.config.port}`)
        resolve()
      })
    })
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.log('info', 'Web debugging server stopped')
        resolve()
      })
    })
  }

  public getConfig(): WebDebugConfig {
    return { ...this.config }
  }

  public getSessions(): WebDebugSession[] {
    return Array.from(this.sessions.values())
  }
}
