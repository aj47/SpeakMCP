import React, { useState } from 'react'
import { WebDebugSession } from '../server'

interface SessionListProps {
  sessions: WebDebugSession[]
  currentSession: WebDebugSession | null
  onSelectSession: (session: WebDebugSession) => void
  onCreateSession: (name: string, initialMessage?: string) => void
  onDeleteSession: (sessionId: string) => void
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  currentSession,
  onSelectSession,
  onCreateSession,
  onDeleteSession
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const [initialMessage, setInitialMessage] = useState('')

  const handleCreateSession = () => {
    if (newSessionName.trim()) {
      onCreateSession(newSessionName.trim(), initialMessage.trim() || undefined)
      setNewSessionName('')
      setInitialMessage('')
      setShowCreateForm(false)
    }
  }

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
    <div className="space-y-4">
      {/* Create Session Button */}
      <button
        onClick={() => setShowCreateForm(!showCreateForm)}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
      >
        {showCreateForm ? 'Cancel' : 'New Session'}
      </button>

      {/* Create Session Form */}
      {showCreateForm && (
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Session Name
              </label>
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="Enter session name..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Initial Message (Optional)
              </label>
              <textarea
                value={initialMessage}
                onChange={(e) => setInitialMessage(e.target.value)}
                placeholder="Enter initial message..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <button
              onClick={handleCreateSession}
              disabled={!newSessionName.trim()}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-700"
            >
              Create Session
            </button>
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
            No sessions yet. Create one to get started.
          </p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                currentSession?.id === session.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              onClick={() => onSelectSession(session)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {session.name}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(session.status)}`}>
                      {session.status}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {session.messages.length} msgs
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {session.toolCalls.length} tools
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatTimestamp(session.createdAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession(session.id)
                  }}
                  className="ml-2 p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                  title="Delete session"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              
              {/* Show last message preview */}
              {session.messages.length > 0 && (
                <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs">
                  <span className="font-medium text-gray-600 dark:text-gray-400">
                    {session.messages[session.messages.length - 1].role}:
                  </span>
                  <span className="text-gray-700 dark:text-gray-300 ml-1">
                    {session.messages[session.messages.length - 1].content.substring(0, 100)}
                    {session.messages[session.messages.length - 1].content.length > 100 && '...'}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
