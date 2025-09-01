import React, { useState, useRef, useEffect } from 'react'
import { WebDebugSession, WebDebugMessage } from '../server'

interface ConversationHistoryProps {
  session: WebDebugSession
  onSendMessage: (content: string, role?: 'user' | 'assistant' | 'tool') => void
  onSimulateAgent: (transcript: string) => void
}

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  session,
  onSendMessage,
  onSimulateAgent
}) => {
  const [newMessage, setNewMessage] = useState('')
  const [messageRole, setMessageRole] = useState<'user' | 'assistant' | 'tool'>('user')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages])

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      onSendMessage(newMessage.trim(), messageRole)
      setNewMessage('')
    }
  }

  const handleSimulateAgent = () => {
    if (newMessage.trim()) {
      onSimulateAgent(newMessage.trim())
      setNewMessage('')
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'user':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'assistant':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'tool':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    }
  }

  const renderMessageContent = (message: WebDebugMessage) => {
    // Handle JSON content
    try {
      const parsed = JSON.parse(message.content)
      return (
        <pre className="whitespace-pre-wrap text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )
    } catch {
      // Regular text content
      return (
        <div className="whitespace-pre-wrap text-sm">
          {message.content}
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {session.name}
        </h2>
        <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
          <span>Messages: {session.messages.length}</span>
          <span>Tool Calls: {session.toolCalls.length}</span>
          <span>Status: {session.status}</span>
          <span>Created: {new Date(session.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {session.messages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <p>No messages in this conversation yet.</p>
            <p className="text-sm mt-2">Send a message below to get started.</p>
          </div>
        ) : (
          session.messages.map((message) => (
            <div
              key={message.id}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleColor(message.role)}`}>
                  {message.role}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTimestamp(message.timestamp)}
                </span>
              </div>
              
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                {renderMessageContent(message)}
                
                {/* Tool calls */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Tool Calls:
                    </h4>
                    <div className="space-y-2">
                      {message.toolCalls.map((toolCall, index) => (
                        <div key={index} className="bg-gray-50 dark:bg-gray-700 p-2 rounded text-sm">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {toolCall.name}
                          </div>
                          <pre className="text-xs text-gray-600 dark:text-gray-400 mt-1 overflow-x-auto">
                            {JSON.stringify(toolCall.arguments, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tool results */}
                {message.toolResults && message.toolResults.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Tool Results:
                    </h4>
                    <div className="space-y-2">
                      {message.toolResults.map((result, index) => (
                        <div key={index} className={`p-2 rounded text-sm ${
                          result.success 
                            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                        }`}>
                          <div className={`font-medium ${
                            result.success 
                              ? 'text-green-800 dark:text-green-200'
                              : 'text-red-800 dark:text-red-200'
                          }`}>
                            {result.success ? 'Success' : 'Error'}
                          </div>
                          <div className="text-xs mt-1 whitespace-pre-wrap">
                            {result.error || result.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="space-y-3">
          {/* Role Selector */}
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Role:
            </label>
            <div className="flex space-x-2">
              {(['user', 'assistant', 'tool'] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setMessageRole(role)}
                  className={`px-3 py-1 text-xs font-medium rounded-full capitalize ${
                    messageRole === role
                      ? getRoleColor(role)
                      : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          {/* Message Input */}
          <div className="flex space-x-2">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type your message..."
              rows={3}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
            />
            <div className="flex flex-col space-y-2">
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                Send
              </button>
              <button
                onClick={handleSimulateAgent}
                disabled={!newMessage.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 text-sm"
              >
                Agent
              </button>
            </div>
          </div>
          
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Press Enter to send, Shift+Enter for new line. Use "Agent" button to simulate agent mode processing.
          </p>
        </div>
      </div>
    </div>
  )
}
