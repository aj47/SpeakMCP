import React from 'react'
import { WebDebugSession } from '../server'

interface SessionViewProps {
  session: WebDebugSession
}

export const SessionView: React.FC<SessionViewProps> = ({ session }) => {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const getStatusColor = (status: WebDebugSession['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'completed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    }
  }

  return (
    <div className="p-6">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {session.name}
            </h2>
            <div className="flex items-center space-x-4">
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(session.status)}`}>
                {session.status}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Created: {formatTimestamp(session.createdAt)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Session ID: {session.id}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Messages
            </h3>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {session.messages.length}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Total messages in conversation
            </p>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Tool Calls
            </h3>
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
              {session.toolCalls.length}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Total tool executions
            </p>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Success Rate
            </h3>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">
              {session.toolCalls.length > 0 
                ? Math.round((session.toolCalls.filter(tc => tc.status === 'completed').length / session.toolCalls.length) * 100)
                : 0}%
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Successful tool calls
            </p>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Recent Activity
          </h3>
          <div className="space-y-3">
            {session.messages.slice(-5).map((message) => (
              <div key={message.id} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className={`px-2 py-1 text-xs font-medium rounded-full ${
                  message.role === 'user' 
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : message.role === 'assistant'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                }`}>
                  {message.role}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-900 dark:text-white">
                    {message.content.length > 100 
                      ? `${message.content.substring(0, 100)}...`
                      : message.content
                    }
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatTimestamp(message.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            {session.messages.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                No messages in this session yet.
              </p>
            )}
          </div>
        </div>

        {/* Tool Call Summary */}
        {session.toolCalls.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Tool Call Summary
            </h3>
            <div className="space-y-2">
              {Object.entries(
                session.toolCalls.reduce((acc, tc) => {
                  acc[tc.name] = (acc[tc.name] || 0) + 1
                  return acc
                }, {} as Record<string, number>)
              ).map(([toolName, count]) => (
                <div key={toolName} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {toolName}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {count} call{count !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
