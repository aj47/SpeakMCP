import React, { useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { WebDebugSession, WebDebugMessage, WebDebugToolCall, WebDebugToolResult } from '../server'
import { SessionList } from './SessionList'
import { SessionView } from './SessionView'
import { ToolCallVisualizer } from './ToolCallVisualizer'
import { ConversationHistory } from './ConversationHistory'
import { AgentProgressViewer } from './AgentProgressViewer'
import { MockMCPService } from '../mock-mcp-service'
import type { AgentProgressUpdate } from '../../shared/types'

interface WebDebugAppProps {
  serverUrl?: string
}

export const WebDebugApp: React.FC<WebDebugAppProps> = ({ 
  serverUrl = 'http://localhost:3001' 
}) => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [sessions, setSessions] = useState<WebDebugSession[]>([])
  const [currentSession, setCurrentSession] = useState<WebDebugSession | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [agentProgress, setAgentProgress] = useState<AgentProgressUpdate | null>(null)
  const [mockMCPService] = useState(() => new MockMCPService())
  const [activeView, setActiveView] = useState<'sessions' | 'conversation' | 'tools' | 'agent'>('sessions')

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
      }
    })

    newSocket.on('message', ({ sessionId, message }: { sessionId: string, message: WebDebugMessage }) => {
      setSessions(prev => prev.map(session => 
        session.id === sessionId 
          ? { ...session, messages: [...session.messages, message] }
          : session
      ))
      
      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => prev ? {
          ...prev,
          messages: [...prev.messages, message]
        } : null)
      }
    })

    newSocket.on('toolCall', (toolCall: WebDebugToolCall) => {
      setSessions(prev => prev.map(session => 
        session.id === toolCall.sessionId 
          ? { ...session, toolCalls: [...session.toolCalls, toolCall] }
          : session
      ))
      
      if (currentSession?.id === toolCall.sessionId) {
        setCurrentSession(prev => prev ? {
          ...prev,
          toolCalls: [...prev.toolCalls, toolCall]
        } : null)
      }
    })

    newSocket.on('toolCallUpdate', (toolCall: WebDebugToolCall) => {
      setSessions(prev => prev.map(session => 
        session.id === toolCall.sessionId 
          ? { 
              ...session, 
              toolCalls: session.toolCalls.map(tc => 
                tc.id === toolCall.id ? toolCall : tc
              )
            }
          : session
      ))
      
      if (currentSession?.id === toolCall.sessionId) {
        setCurrentSession(prev => prev ? {
          ...prev,
          toolCalls: prev.toolCalls.map(tc => 
            tc.id === toolCall.id ? toolCall : tc
          )
        } : null)
      }
    })

    newSocket.on('toolResult', (result: WebDebugToolResult) => {
      // Handle tool results if needed
      console.log('Tool result received:', result)
    })

    // Load initial sessions
    loadSessions()

    return () => {
      newSocket.close()
    }
  }, [serverUrl])

  useEffect(() => {
    // Set up mock MCP service progress callback
    mockMCPService.setProgressCallback((update: AgentProgressUpdate) => {
      setAgentProgress(update)
    })
  }, [mockMCPService])

  const loadSessions = async () => {
    try {
      const response = await fetch(`${serverUrl}/api/sessions`)
      const sessionsData = await response.json()
      setSessions(sessionsData)
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
      setActiveView('conversation')
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

  const sendMessage = async (content: string, role: 'user' | 'assistant' | 'tool' = 'user') => {
    if (!currentSession) return

    try {
      const response = await fetch(`${serverUrl}/api/sessions/${currentSession.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, role })
      })
      const message = await response.json()
      return message
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const executeToolCall = async (name: string, args: any) => {
    if (!currentSession) return

    try {
      const response = await fetch(`${serverUrl}/api/sessions/${currentSession.id}/tool-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args })
      })
      const toolCall = await response.json()
      return toolCall
    } catch (error) {
      console.error('Failed to execute tool call:', error)
    }
  }

  const simulateAgentMode = async (transcript: string) => {
    if (!currentSession) return

    setAgentProgress(null)
    setActiveView('agent')
    
    // Start the mock agent simulation
    await mockMCPService.simulateAgentMode(transcript, 5)
  }

  const clearAgentProgress = () => {
    setAgentProgress(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                SpeakMCP Web Debugger
              </h1>
              <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                isConnected 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
              }`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
            
            <nav className="flex space-x-4">
              {['sessions', 'conversation', 'tools', 'agent'].map((view) => (
                <button
                  key={view}
                  onClick={() => setActiveView(view as any)}
                  className={`px-3 py-2 rounded-md text-sm font-medium capitalize ${
                    activeView === view
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {view}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Sessions
              </h2>
              <SessionList
                sessions={sessions}
                currentSession={currentSession}
                onSelectSession={setCurrentSession}
                onCreateSession={createSession}
                onDeleteSession={deleteSession}
              />
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-3">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
              {activeView === 'sessions' && (
                <div className="p-6">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                    Debug Sessions Overview
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Create a new session or select an existing one to start debugging agent tool calls and conversations.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <h3 className="font-medium text-gray-900 dark:text-white">Total Sessions</h3>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{sessions.length}</p>
                    </div>
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <h3 className="font-medium text-gray-900 dark:text-white">Active Sessions</h3>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {sessions.filter(s => s.status === 'active').length}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeView === 'conversation' && currentSession && (
                <ConversationHistory
                  session={currentSession}
                  onSendMessage={sendMessage}
                  onSimulateAgent={simulateAgentMode}
                />
              )}

              {activeView === 'tools' && currentSession && (
                <ToolCallVisualizer
                  session={currentSession}
                  onExecuteToolCall={executeToolCall}
                />
              )}

              {activeView === 'agent' && (
                <AgentProgressViewer
                  progress={agentProgress}
                  onClearProgress={clearAgentProgress}
                  onSimulateAgent={simulateAgentMode}
                />
              )}

              {!currentSession && (activeView === 'conversation' || activeView === 'tools') && (
                <div className="p-6 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    Select a session to view {activeView === 'conversation' ? 'conversation history' : 'tool calls'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
