import React, { useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { WebDebugSession, WebDebugMessage, WebDebugToolCall, WebDebugToolResult } from '../server'
import type { AgentProgressUpdate, Conversation, ConversationMessage, Config, MCPConfig } from '../../shared/types'
import type { MCPTool, MCPToolCall, MCPToolResult } from '../web-mcp-service'

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
  const [activeView, setActiveView] = useState<'conversations' | 'agent' | 'settings'>('conversations')
  const [newSessionName, setNewSessionName] = useState('')
  const [showCreateSession, setShowCreateSession] = useState(false)

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
      console.log('Connected to web debug server')
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      console.log('Disconnected from web debug server')
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
      console.error('Failed to load sessions:', error)
    }
  }

  const createSession = async (name: string, initialMessage?: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, initialMessage })
      })
      const session = await response.json()
      setCurrentSession(session)
      setCurrentConversation(convertSessionToConversation(session))
      setActiveView('conversations')
      setShowCreateSession(false)
      setNewSessionName('')
      return session
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const deleteSession = async (sessionId: string) => {
    try {
      await fetch(`${serverUrl}/api/sessions/${sessionId}`, {
        method: 'DELETE'
      })
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const loadMCPData = async () => {
    try {
      // Load MCP tools
      const toolsResponse = await fetch(`${serverUrl}/api/mcp/tools`)
      if (toolsResponse.ok) {
        const tools = await toolsResponse.json()
        setMcpTools(tools)
        console.log('[WebDebugApp] Loaded MCP tools:', tools.length)
      }

      // Load MCP configuration
      const configResponse = await fetch(`${serverUrl}/api/mcp/config`)
      if (configResponse.ok) {
        const config = await configResponse.json()
        setMcpConfig(config.mcpConfig || { mcpServers: {} })
        console.log('[WebDebugApp] Loaded MCP config:', config)
      }
    } catch (error) {
      console.error('[WebDebugApp] Failed to load MCP data:', error)
    }
  }

  const sendMessage = async (content: string, role: 'user' | 'assistant' | 'tool' = 'user') => {
    if (!currentSession) return

    try {
      const response = await fetch(`${serverUrl}/api/sessions/${currentSession.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, role })
      })
      const message = await response.json()

      // Refresh sessions to ensure UI is in sync
      await loadSessions()

      return message
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const simulateAgentMode = async (transcript: string) => {
    if (!currentSession) return

    // Add user message first
    await sendMessage(transcript, 'user')

    setAgentProgress(null)
    setActiveView('agent')

    try {
      // Start the real MCP agent simulation
      const response = await fetch(`${serverUrl}/api/mcp/simulate-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          maxIterations: mockConfig.mcpMaxIterations || 10
        })
      })

      if (response.ok) {
        const { result } = await response.json()
        console.log('[WebDebugApp] Agent simulation result:', result)

        // Add the agent's response to the conversation
        if (result) {
          await sendMessage(result, 'assistant')
        }
      } else {
        const error = await response.json()
        console.error('[WebDebugApp] Agent simulation failed:', error)
        await sendMessage(`Agent simulation failed: ${error.message || 'Unknown error'}`, 'assistant')
      }
    } catch (error) {
      console.error('[WebDebugApp] Agent simulation error:', error)
      await sendMessage(`Agent simulation error: ${error instanceof Error ? error.message : String(error)}`, 'assistant')
    }
  }

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) return
    await createSession(newSessionName.trim())
  }

  const selectSession = (session: WebDebugSession) => {
    setCurrentSession(session)
    setCurrentConversation(convertSessionToConversation(session))
    setActiveView('conversations')
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
                    SpeakMCP Web Debugger
                  </h1>
                  <Badge variant={isConnected ? 'default' : 'destructive'}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>

                <nav className="flex space-x-2">
                  {[
                    { key: 'conversations', label: 'Conversations' },
                    { key: 'agent', label: 'Agent Progress' },
                    { key: 'settings', label: 'Settings' }
                  ].map((view) => (
                    <Button
                      key={view.key}
                      variant={activeView === view.key ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setActiveView(view.key as any)}
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
                                  <h3 className="text-sm font-medium modern-text-strong truncate">
                                    {session.name}
                                  </h3>
                                  <div className="flex items-center space-x-2 mt-1">
                                    <Badge variant="outline" className="text-xs">
                                      {session.status}
                                    </Badge>
                                    <span className="text-xs modern-text-muted">
                                      {session.messages.length} msgs
                                    </span>
                                  </div>
                                  <p className="text-xs modern-text-muted mt-1">
                                    {new Date(session.createdAt).toLocaleString()}
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
                  </CardContent>
                </Card>
              </div>

              {/* Main Content Area */}
              <div className="lg:col-span-3">
                <Card className="modern-panel h-full">
                  {activeView === 'conversations' && (
                    <>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span>
                            {currentConversation ? currentConversation.title : 'Conversation Debug'}
                          </span>
                          {currentConversation && (
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline">
                                {currentConversation.messages.length} messages
                              </Badge>
                            </div>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0">
                        {currentConversation ? (
                          <div className="h-full flex flex-col space-y-4">
                            {/* Conversation Display */}
                            <div className="flex-1 min-h-0">
                              <ConversationDisplay
                                messages={currentConversation.messages}
                                maxHeight="100%"
                                className="h-full"
                              />
                            </div>

                            {/* Input Area */}
                            <div className="space-y-3 modern-panel-subtle p-4 rounded-lg">
                              <div className="flex space-x-2">
                                <Textarea
                                  placeholder="Type a message or agent request..."
                                  className="flex-1"
                                  rows={3}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      const content = e.currentTarget.value.trim()
                                      if (content) {
                                        sendMessage(content, 'user')
                                        e.currentTarget.value = ''
                                      }
                                    }
                                  }}
                                />
                                <div className="flex flex-col space-y-2">
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      const textarea = e.currentTarget.parentElement?.parentElement?.querySelector('textarea')
                                      const content = textarea?.value.trim()
                                      if (content) {
                                        sendMessage(content, 'user')
                                        textarea.value = ''
                                      }
                                    }}
                                  >
                                    Send
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => {
                                      const textarea = e.currentTarget.parentElement?.parentElement?.querySelector('textarea')
                                      const content = textarea?.value.trim()
                                      if (content) {
                                        simulateAgentMode(content)
                                        textarea.value = ''
                                      }
                                    }}
                                  >
                                    Agent
                                  </Button>
                                </div>
                              </div>
                              <p className="text-xs modern-text-muted">
                                Press Enter to send, Shift+Enter for new line. Use "Agent" for agent mode simulation.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-64">
                            <div className="text-center">
                              <p className="modern-text-muted mb-4">
                                Select a session to view conversation history
                              </p>
                              <Button onClick={() => setShowCreateSession(true)}>
                                Create New Session
                              </Button>
                            </div>
                          </div>
                        )}
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
                                  placeholder="Enter a request to simulate agent mode..."
                                  rows={3}
                                  id="agent-input"
                                />
                                <Button
                                  onClick={() => {
                                    const textarea = document.getElementById('agent-input') as HTMLTextAreaElement
                                    const content = textarea?.value.trim()
                                    if (content) {
                                      simulateAgentMode(content)
                                      textarea.value = ''
                                    }
                                  }}
                                >
                                  Simulate Agent Mode
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
