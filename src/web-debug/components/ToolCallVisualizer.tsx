import React, { useState } from 'react'
import { WebDebugSession, WebDebugToolCall } from '../server'

interface ToolCallVisualizerProps {
  session: WebDebugSession
  onExecuteToolCall: (name: string, args: any) => void
}

export const ToolCallVisualizer: React.FC<ToolCallVisualizerProps> = ({
  session,
  onExecuteToolCall
}) => {
  const [showExecuteForm, setShowExecuteForm] = useState(false)
  const [toolName, setToolName] = useState('')
  const [toolArgs, setToolArgs] = useState('{}')
  const [selectedToolCall, setSelectedToolCall] = useState<WebDebugToolCall | null>(null)

  const handleExecuteToolCall = () => {
    try {
      const args = JSON.parse(toolArgs)
      onExecuteToolCall(toolName, args)
      setToolName('')
      setToolArgs('{}')
      setShowExecuteForm(false)
    } catch (error) {
      alert('Invalid JSON in arguments')
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const getStatusColor = (status: WebDebugToolCall['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      case 'executing':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    }
  }

  const commonTools = [
    'filesystem_read',
    'filesystem_write',
    'web_search',
    'calculator',
    'weather',
    'email_send',
    'calendar_create_event'
  ]

  const getToolTemplate = (toolName: string) => {
    const templates: Record<string, any> = {
      'filesystem_read': { path: '/example/file.txt' },
      'filesystem_write': { path: '/example/file.txt', content: 'Hello, World!' },
      'web_search': { query: 'example search', limit: 5 },
      'calculator': { expression: '2 + 2' },
      'weather': { location: 'San Francisco, CA', units: 'fahrenheit' },
      'email_send': { to: 'user@example.com', subject: 'Test Email', body: 'This is a test email.' },
      'calendar_create_event': { 
        title: 'Meeting', 
        start: new Date().toISOString(), 
        end: new Date(Date.now() + 3600000).toISOString(),
        description: 'Team meeting'
      }
    }
    return templates[toolName] || {}
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Tool Call Visualizer
        </h2>
        <button
          onClick={() => setShowExecuteForm(!showExecuteForm)}
          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
        >
          {showExecuteForm ? 'Cancel' : 'Execute Tool Call'}
        </button>
      </div>

      {/* Execute Tool Call Form */}
      {showExecuteForm && (
        <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Execute New Tool Call
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Tool Name
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="Enter tool name..."
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-gray-800 dark:text-white"
                />
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      setToolName(e.target.value)
                      setToolArgs(JSON.stringify(getToolTemplate(e.target.value), null, 2))
                    }
                  }}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Quick Select</option>
                  {commonTools.map(tool => (
                    <option key={tool} value={tool}>{tool}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Arguments (JSON)
              </label>
              <textarea
                value={toolArgs}
                onChange={(e) => setToolArgs(e.target.value)}
                placeholder='{"key": "value"}'
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-gray-800 dark:text-white font-mono text-sm"
              />
            </div>
            <button
              onClick={handleExecuteToolCall}
              disabled={!toolName.trim()}
              className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-700"
            >
              Execute Tool Call
            </button>
          </div>
        </div>
      )}

      {/* Tool Calls List */}
      <div className="space-y-4">
        {session.toolCalls.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <p>No tool calls in this session yet.</p>
            <p className="text-sm mt-2">Execute a tool call above to see it here.</p>
          </div>
        ) : (
          session.toolCalls.map((toolCall) => (
            <div
              key={toolCall.id}
              className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                selectedToolCall?.id === toolCall.id
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-400'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              onClick={() => setSelectedToolCall(selectedToolCall?.id === toolCall.id ? null : toolCall)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {toolCall.name}
                    </h3>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(toolCall.status)}`}>
                      {toolCall.status}
                    </span>
                    {toolCall.duration && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {toolCall.duration}ms
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formatTimestamp(toolCall.timestamp)}
                  </p>
                </div>
                <div className="text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedToolCall(selectedToolCall?.id === toolCall.id ? null : toolCall)
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg 
                      className={`w-5 h-5 transition-transform ${selectedToolCall?.id === toolCall.id ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {selectedToolCall?.id === toolCall.id && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Arguments
                      </h4>
                      <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                        {JSON.stringify(toolCall.arguments, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Metadata
                      </h4>
                      <div className="text-xs space-y-1">
                        <div><span className="font-medium">ID:</span> {toolCall.id}</div>
                        <div><span className="font-medium">Session:</span> {toolCall.sessionId}</div>
                        <div><span className="font-medium">Message:</span> {toolCall.messageId}</div>
                        <div><span className="font-medium">Status:</span> {toolCall.status}</div>
                        {toolCall.duration && (
                          <div><span className="font-medium">Duration:</span> {toolCall.duration}ms</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-4 flex space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setToolName(toolCall.name)
                        setToolArgs(JSON.stringify(toolCall.arguments, null, 2))
                        setShowExecuteForm(true)
                      }}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigator.clipboard.writeText(JSON.stringify({
                          name: toolCall.name,
                          arguments: toolCall.arguments
                        }, null, 2))
                      }}
                      className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                    >
                      Copy JSON
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
