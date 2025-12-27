import { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { agentService, type AgentProgress } from './services/agent-service.js'
import { mcpService } from './services/mcp-service.js'

interface WebSocketClient {
  ws: WebSocket
  subscriptions: Set<string>
}

const clients: Set<WebSocketClient> = new Set()

export async function setupWebSocket(server: FastifyInstance): Promise<void> {
  server.get('/api/ws', { websocket: true }, (socket, request) => {
    const client: WebSocketClient = {
      ws: socket,
      subscriptions: new Set(),
    }
    clients.add(client)

    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString())
        handleClientMessage(client, message)
      } catch (e) {
        socket.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format',
        }))
      }
    })

    socket.on('close', () => {
      clients.delete(client)
    })

    socket.on('error', (error) => {
      console.error('WebSocket error:', error)
      clients.delete(client)
    })

    // Send welcome message
    socket.send(JSON.stringify({
      type: 'connected',
      timestamp: Date.now(),
    }))
  })

  // Set up event listeners
  setupAgentEventListeners()
  setupMcpEventListeners()
}

function handleClientMessage(client: WebSocketClient, message: any): void {
  switch (message.type) {
    case 'subscribe':
      if (message.channel) {
        client.subscriptions.add(message.channel)
        client.ws.send(JSON.stringify({
          type: 'subscribed',
          channel: message.channel,
        }))
      }
      break

    case 'unsubscribe':
      if (message.channel) {
        client.subscriptions.delete(message.channel)
        client.ws.send(JSON.stringify({
          type: 'unsubscribed',
          channel: message.channel,
        }))
      }
      break

    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
      break

    case 'approval':
      // Handle tool approval via WebSocket
      if (message.sessionId && typeof message.approved === 'boolean') {
        agentService.respondToApproval(message.sessionId, message.approved)
        client.ws.send(JSON.stringify({
          type: 'approval_response',
          sessionId: message.sessionId,
          approved: message.approved,
        }))
      }
      break

    default:
      client.ws.send(JSON.stringify({
        type: 'error',
        error: `Unknown message type: ${message.type}`,
      }))
  }
}

function setupAgentEventListeners(): void {
  agentService.on('approval:required', (data) => {
    broadcast('agent-progress', {
      type: 'approval_required',
      ...data,
    })
    // Also broadcast to session-specific channel
    broadcast(`session:${data.sessionId}`, {
      type: 'approval_required',
      ...data,
    })
  })
}

function setupMcpEventListeners(): void {
  mcpService.on('server:starting', (data) => {
    broadcast('mcp', { type: 'server_starting', ...data })
  })

  mcpService.on('server:started', (data) => {
    broadcast('mcp', { type: 'server_started', ...data })
  })

  mcpService.on('server:stopped', (data) => {
    broadcast('mcp', { type: 'server_stopped', ...data })
  })

  mcpService.on('server:error', (data) => {
    broadcast('mcp', { type: 'server_error', ...data })
  })
}

function broadcast(channel: string, message: any): void {
  const payload = JSON.stringify({
    channel,
    ...message,
    timestamp: Date.now(),
  })

  for (const client of clients) {
    if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload)
      }
    }
  }
}

// Export for use in agent processing
export function broadcastAgentProgress(progress: AgentProgress): void {
  broadcast('agent-progress', progress)
  if (progress.sessionId) {
    broadcast(`session:${progress.sessionId}`, progress)
  }
  if (progress.conversationId) {
    broadcast(`conversation:${progress.conversationId}`, progress)
  }
}

