import React, { useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { WebDebugSession, WebDebugMessage, WebDebugToolCall, WebDebugToolResult } from '../server'
import type { AgentProgressUpdate, Conversation, ConversationMessage, Config, MCPConfig } from '../../shared/types'
import type { MCPTool, MCPToolCall, MCPToolResult } from '../web-mcp-service'
import { logger } from '../utils/logger'
import { DebugLogsPanel } from './DebugLogsPanel'
import { webDebugConfig } from '../config'

// Import existing components from the main app
import { AgentProgress } from '../../renderer/src/components/agent-progress'
import { ConversationDisplay } from '../../renderer/src/components/conversation-display'
import { Button } from '../../renderer/src/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../renderer/src/components/ui/card'
import { Input } from '../../renderer/src/components/ui/input'
import { Textarea } from '../../renderer/src/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../renderer/src/components/ui/select'
import { Badge } from '../../renderer/src/components/ui/badge'
import { ScrollArea } from '../../renderer/src/components/ui/scroll-area'
import { ThemeProvider } from '../../renderer/src/contexts/theme-context'
import { ConversationProvider } from '../../renderer/src/contexts/conversation-context'
import { cn } from '../../renderer/src/lib/utils'

interface WebDebugAppProps {
  serverUrl?: string
}

// Mock configuration for web debugging mode
const mockConfig: Partial<Config> = {
  themePreference: 'system',
  mcpToolsEnabled: true,
  mcpAgentModeEnabled: true,
  mcpMaxIterations: 10,
  conversationsEnabled: true,
  autoSaveConversations: false, // Don't save in web mode
}

export const WebDebugApp: React.FC<WebDebugAppProps> = ({
  serverUrl = `${window.location.protocol}//${window.location.host}`
}) => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [sessions, setSessions] = useState<WebDebugSession[]>([])
  const [currentSession, setCurrentSession] = useState<WebDebugSession | null>(null)
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [agentProgress, setAgentProgress] = useState<AgentProgressUpdate | null>(null)
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])
  const [mcpConfig, setMcpConfig] = useState<MCPConfig>({ mcpServers: {} })
  const [activeView, setActiveView] = useState<'conversations' | 'agent' | 'settings'>('agent')
  const [newSessionName, setNewSessionName] = useState('')
  const [showCreateSession, setShowCreateSession] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [autoSessionEnabled, setAutoSessionEnabled] = useState(webDebugConfig.autoSessionEnabled)

  // Convert WebDebugSession to Conversation format
  const convertSessionToConversation = (session: WebDebugSession): Conversation => {
    return {
      id: session.id,
      title: session.name,
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
      messages: session.messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        toolCalls: msg.toolCalls,
        toolResults: msg.toolResults
      }))
    }
  }

  useEffect(() => {
    const newSocket = io(serverUrl)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      setIsConnected(true)
      logger.info('network', 'Connected to web debug server')
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      logger.warn('network', 'Disconnected from web debug server')
    })

    newSocket.on('sessionCreated', (session: WebDebugSession) => {
      setSessions(prev => [...prev, session])
    })

    newSocket.on('sessionDeleted', ({ sessionId }: { sessionId: string }) => {
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (currentSession?.id === sessionId) {
        setCurrentSession(null)
        setCurrentConversation(null)
      }
    })

    newSocket.on('message', ({ sessionId, message }: { sessionId: string, message: WebDebugMessage }) => {
      setSessions(prev => prev.map(session =>
        session.id === sessionId
          ? { ...session, messages: [...session.messages, message] }
          : session
      ))

      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => {
          if (!prev) return null
          const updated = { ...prev, messages: [...prev.messages, message] }
          setCurrentConversation(convertSessionToConversation(updated))
          return updated
        })
      }
    })

    // Listen for agent progress updates
    newSocket.on('agentProgress', (update: AgentProgressUpdate) => {
      logger.debug('agent', 'Received agent progress update', {
        sessionId: currentSession?.id,
        data: update
      })
      setAgentProgress(update)
    })

    // Load initial sessions
    loadSessions()

    return () => {
      newSocket.close()
    }
  }, [serverUrl])

  useEffect(() => {
    // Load MCP tools and configuration
    loadMCPData()
  }, [])

  useEffect(() => {
    // Update current conversation when session changes
    if (currentSession) {
      setCurrentConversation(convertSessionToConversation(currentSession))
    } else {
      setCurrentConversation(null)
    }
  }, [currentSession])

  const loadSessions = async () => {
    try {
      const response = await fetch(`${serverUrl}/api/sessions`)
      const sessionsData = await response.json()
      setSessions(sessionsData)

      // If we have a current session, update it with the latest data
      if (currentSession) {
        const updatedCurrentSession = sessionsData.find((s: WebDebugSession) => s.id === currentSession.id)
        if (updatedCurrentSession) {
          setCurrentSession(updatedCurrentSession)
          setCurrentConversation(convertSessionToConversation(updatedCurrentSession))
        }
      }
    } catch (error) {
      logger.error('network', 'Failed to load sessions', { error })
    }
  }

  const createSession = async (name: string, initialMessage?: string) => {
    try {
      logger.info('session', `Creating new session: ${name}`)
      const response = await fetch(`${serverUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, initialMessage })
      })
      const session = await response.json()
      setCurrentSession(session)
      setCurrentConversation(convertSessionToConversation(session))
      setActiveView('agent')
      setShowCreateSession(false)
      setNewSessionName('')
      logger.info('session', `Session created successfully: ${session.id}`, { sessionId: session.id })
      return session
    } catch (error) {
      logger.error('session', 'Failed to create session', { error })
      throw error
    }
  }

  // Auto-session creation helper with idempotency guard
  const ensureSession = async (): Promise<WebDebugSession> => {
    // If session already exists, return it
    if (currentSession) {
      return currentSession
    }

    // If already creating a session, wait for it
    if (isCreatingSession) {
      logger.debug('session', 'Session creation already in progress, waiting...')
      // Poll until session is created or creation fails
      return new Promise((resolve, reject) => {
        const checkSession = () => {
          if (currentSession) {
            resolve(currentSession)
          } else if (!isCreatingSession) {
            reject(new Error('Session creation failed'))
          } else {
            setTimeout(checkSession, 100)
          }
        }
        checkSession()
      })
    }

    // Create new session
    setIsCreatingSession(true)
    try {
      logger.info('session', 'Auto-creating session for message')
      const sessionName = `Auto Session ${new Date().toLocaleTimeString()}`
      const session = await createSession(sessionName)
      if (!session) {
        throw new Error('Failed to create session')
      }
      return session
    } finally {
      setIsCreatingSession(false)
    }
  }

  const deleteSession = async (sessionId: string) => {
    try {
      logger.info('session', `Deleting session: ${sessionId}`, { sessionId })
      await fetch(`${serverUrl}/api/sessions/${sessionId}`, {
        method: 'DELETE'
      })
      logger.info('session', `Session deleted successfully: ${sessionId}`, { sessionId })
    } catch (error) {
      logger.error('session', 'Failed to delete session', { sessionId, error })
    }
  }

  const loadMCPData = async () => {
    try {
      // Load MCP tools
      const toolsResponse = await fetch(`${serverUrl}/api/mcp/tools`)
      if (toolsResponse.ok) {
        const tools = await toolsResponse.json()
        setMcpTools(tools)
        logger.info('mcp-client', `Loaded MCP tools: ${tools.length}`)
      }

      // Load MCP configuration
      const configResponse = await fetch(`${serverUrl}/api/mcp/config`)
      if (configResponse.ok) {
        const config = await configResponse.json()
        setMcpConfig(config.mcpConfig || { mcpServers: {} })
        logger.info('mcp-client', 'Loaded MCP config', { data: config })
      }
    } catch (error) {
      logger.error('mcp-client', 'Failed to load MCP data', { error })
    }
  }

  // Agent request using production-compatible schema: { text: string, conversationId?: string }
  const sendAgentRequest = async (text: string, maxIterations: number = 10, sessionId?: string) => {
    const targetSessionId = sessionId || currentSession?.id
    if (!targetSessionId) {
      throw new Error('No session available for agent request')
    }

    try {
      logger.info('agent', `Sending agent request: ${text.substring(0, 100)}...`, {
        sessionId: targetSessionId,
        messageId: `msg_${Date.now()}`
      })

      const response = await fetch(`${serverUrl}/api/sessions/${targetSessionId}/agent-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          conversationId: targetSessionId, // Include conversationId for production compatibility
          maxIterations
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Agent request failed')
      }

      const result = await response.json()

      // Refresh sessions to ensure UI is in sync
      await loadSessions()

      logger.info('agent', 'Agent request completed successfully', {
        sessionId: targetSessionId
      })
      return result
    } catch (error) {
      logger.error('agent', 'Failed to send agent request', {
        sessionId: targetSessionId,
        error
      })
      throw error
    }
  }

  const processAgentRequest = async (text: string) => {
    setAgentProgress(null)
    setActiveView('agent')

    try {
      // Ensure we have a session (auto-create if needed and enabled)
      let session = currentSession
      if (!session && autoSessionEnabled) {
        logger.info('session', 'Auto-creating session for agent request')
        session = await ensureSession()
      } else if (!session) {
        logger.warn('ui', 'No session available and auto-session disabled')
        return
      }

      // Process through agent pipeline - this handles both user message and agent response
      const result = await sendAgentRequest(text, mockConfig.mcpMaxIterations || 10, session.id)
      logger.info('agent', 'Agent request completed', { sessionId: session.id })
    } catch (error) {
      logger.error('agent', 'Agent request failed', {
        sessionId: currentSession?.id,
        error
      })
      // Error handling is now done in sendAgentRequest, which adds error messages to the session
    } finally {
      // Clear agent progress after completion
      setTimeout(() => setAgentProgress(null), 2000)
    }
  }

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) return
    await createSession(newSessionName.trim())
  }

  const handleResetSession = () => {
    logger.info('session', 'Resetting current session', { sessionId: currentSession?.id })
    setCurrentSession(null)
    setCurrentConversation(null)
    setAgentProgress(null)
    logger.info('ui', 'Session reset - ready for auto-creation on next message')
  }

  const selectSession = (session: WebDebugSession) => {
    setCurrentSession(session)
    setCurrentConversation(convertSessionToConversation(session))
    setActiveView('agent')
  }

  return (
    <ThemeProvider>
      <ConversationProvider>
        <div className="min-h-screen bg-background">
          {/* Header */}
          <header className="modern-nav border-b">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center py-4">
                <div className="flex items-center space-x-4">
                  <h1 className="text-2xl font-bold modern-text-strong">
                    SpeakMCP Agent Mode Debugger
                  </h1>
                  <Badge variant={isConnected ? 'default' : 'destructive'}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>

                <nav className="flex space-x-2">
                  {[
                    { key: 'agent', label: 'Agent Progress', primary: true },
                    { key: 'conversations', label: 'Debug Info', secondary: true },
                    { key: 'settings', label: 'Settings' }
                  ].map((view) => (
                    <Button
                      key={view.key}
                      variant={activeView === view.key ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setActiveView(view.key as any)}
                      className={view.secondary ? 'opacity-60' : ''}
                    >
                      {view.label}
                    </Button>
                  ))}
                </nav>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Sidebar - Sessions */}
              <div className="lg:col-span-1">
                <Card className="modern-panel">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Debug Sessions</span>
                      <Button
                        size="sm"
                        onClick={() => setShowCreateSession(!showCreateSession)}
                      >
                        {showCreateSession ? 'Cancel' : 'New'}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Create Session Form */}
                    {showCreateSession && (
                      <div className="space-y-3 p-3 modern-panel-subtle rounded-lg">
                        <Input
                          placeholder="Session name..."
                          value={newSessionName}
                          onChange={(e) => setNewSessionName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateSession()}
                        />
                        <Button
                          size="sm"
                          onClick={handleCreateSession}
                          disabled={!newSessionName.trim()}
                          className="w-full"
                        >
                          Create Session
                        </Button>
                      </div>
                    )}

                    {/* Sessions List */}
                    <ScrollArea className="h-96">
                      <div className="space-y-2">
                        {sessions.length === 0 ? (
                          <p className="modern-text-muted text-sm text-center py-4">
                            No sessions yet. Create one to get started.
                          </p>
                        ) : (
                          sessions.map((session) => (
                            <div
                              key={session.id}
                              className={cn(
                                "p-3 rounded-lg cursor-pointer transition-colors modern-panel-subtle",
                                currentSession?.id === session.id && "ring-2 ring-primary"
                              )}
                              onClick={() => selectSession(session)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge
                                      variant={session.status === 'active' ? 'default' :
                                              session.status === 'error' ? 'destructive' : 'secondary'}
                                      className="text-xs"
                                    >
                                      {session.status}
                                    </Badge>
                                    {currentSession?.id === session.id && (
                                      <Badge variant="outline" className="text-xs">
                                        CURRENT
                                      </Badge>
                                    )}
                                  </div>
                                  <h3 className="text-sm font-medium modern-text-strong truncate">
                                    {session.name}
                                  </h3>
                                  <div className="flex items-center space-x-2 mt-1">
                                    <span className="text-xs modern-text-muted">
                                      {session.messages.length} msgs
                                    </span>
                                    <span className="text-xs modern-text-muted">
                                      ID: {session.id.slice(-8)}
                                    </span>
                                  </div>
                                  <p className="text-xs modern-text-muted mt-1">
                                    Created: {new Date(session.createdAt).toLocaleString()}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteSession(session.id)
                                  }}
                                  className="h-6 w-6 p-0"
                                >
                                  ×
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>

                    {/* Session Controls */}
                    {currentSession && (
                      <div className="pt-4 border-t border-border space-y-2">
                        <div className="text-xs modern-text-muted mb-2">
                          Current Session: {currentSession.name}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleResetSession}
                          className="w-full"
                        >
                          Reset Session
                        </Button>
                      </div>
                    )}

                    {/* Auto-session toggle */}
                    <div className="pt-4 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs modern-text-muted">Auto-create sessions</span>
                        <Button
                          size="sm"
                          variant={autoSessionEnabled ? "default" : "outline"}
                          onClick={() => {
                            setAutoSessionEnabled(!autoSessionEnabled)
                            logger.info('ui', `Auto-session ${!autoSessionEnabled ? 'enabled' : 'disabled'}`)
                          }}
                        >
                          {autoSessionEnabled ? 'ON' : 'OFF'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Debug Logs Panel */}
                <div className="mt-6">
                  <DebugLogsPanel defaultExpanded={false} />
                </div>
              </div>

              {/* Main Content Area */}
              <div className="lg:col-span-3">
                <Card className="modern-panel h-full">
                  {activeView === 'conversations' && (
                    <>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span>Web Debugging Mode - Agent Focus</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0">
                        <div className="flex items-center justify-center h-64">
                          <div className="text-center space-y-4">
                            <p className="modern-text-muted">
                              Web Debugging Mode focuses on Agent Progress simulation.
                            </p>
                            <Button onClick={() => setActiveView('agent')}>
                              Go to Agent Progress
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </>
                  )}

                  {activeView === 'agent' && (
                    <>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span>Agent Progress Viewer</span>
                          {agentProgress && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAgentProgress(null)}
                            >
                              Clear Progress
                            </Button>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0">
                        {agentProgress ? (
                          <div className="h-full">
                            <AgentProgress
                              progress={agentProgress}
                              variant="default"
                              className="h-full"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-64">
                            <div className="text-center space-y-4">
                              <p className="modern-text-muted">
                                No agent progress to display
                              </p>
                              <div className="space-y-3">
                                <Textarea
                                  placeholder="Enter a request for the agent..."
                                  rows={3}
                                  id="agent-input"
                                />
                                <Button
                                  onClick={() => {
                                    const textarea = document.getElementById('agent-input') as HTMLTextAreaElement
                                    const content = textarea?.value.trim()
                                    if (content) {
                                      processAgentRequest(content)
                                      textarea.value = ''
                                    }
                                  }}
                                >
                                  Send to Agent
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </>
                  )}

                  {activeView === 'settings' && (
                    <>
                      <CardHeader>
                        <CardTitle>Web Debug Settings</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <h3 className="text-lg font-medium modern-text-strong">Connection</h3>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Server Status</span>
                                <Badge variant={isConnected ? 'default' : 'destructive'}>
                                  {isConnected ? 'Connected' : 'Disconnected'}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Server URL</span>
                                <span className="text-sm modern-text-muted">{serverUrl}</span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <h3 className="text-lg font-medium modern-text-strong">Statistics</h3>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Total Sessions</span>
                                <Badge variant="outline">{sessions.length}</Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Active Sessions</span>
                                <Badge variant="outline">
                                  {sessions.filter(s => s.status === 'active').length}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Current Session</span>
                                <Badge variant="outline">
                                  {currentSession ? 'Selected' : 'None'}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="text-lg font-medium modern-text-strong">Real MCP Configuration</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Max Iterations</label>
                              <Input
                                type="number"
                                value={mockConfig.mcpMaxIterations}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value)
                                  if (!isNaN(value) && value > 0) {
                                    mockConfig.mcpMaxIterations = value
                                  }
                                }}
                                min="1"
                                max="20"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Available Tools</label>
                              <Badge variant="outline">
                                {mcpTools.length} tools
                              </Badge>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">MCP Servers</label>
                              <Badge variant="outline">
                                {Object.keys(mcpConfig.mcpServers || {}).length} servers
                              </Badge>
                            </div>
                            <div className="space-y-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={loadMCPData}
                              >
                                Refresh MCP Data
                              </Button>
                            </div>
                          </div>

                          {mcpTools.length > 0 && (
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Available MCP Tools</label>
                              <div className="max-h-32 overflow-y-auto modern-panel-subtle p-3 rounded-lg">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {mcpTools.map((tool, index) => (
                                    <div key={index} className="text-xs">
                                      <Badge variant="secondary" className="text-xs">
                                        {tool.name}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="space-y-4">
                          <h3 className="text-lg font-medium modern-text-strong">About</h3>
                          <div className="modern-panel-subtle p-4 rounded-lg">
                            <p className="text-sm modern-text-muted">
                              SpeakMCP Web Debugging Mode provides a browser-based environment for debugging
                              agent tool calls and conversations using the real MCP (Model Context Protocol)
                              implementation. This mode connects to actual MCP servers and executes real tool
                              calls, making it much closer to the production app experience while still being
                              accessible through a web browser for easier debugging and development.
                            </p>
                            <div className="mt-3 space-y-1">
                              <p className="text-xs modern-text-muted">
                                <strong>Real MCP Integration:</strong> Connects to actual MCP servers and tools
                              </p>
                              <p className="text-xs modern-text-muted">
                                <strong>Live Tool Execution:</strong> Executes real tool calls with actual results
                              </p>
                              <p className="text-xs modern-text-muted">
                                <strong>Agent Mode:</strong> Full agent simulation with real MCP tool calling
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </>
                  )}
                </Card>
              </div>
            </div>
          </main>
        </div>
      </ConversationProvider>
    </ThemeProvider>
  )
}
