/**
 * MDAP Progress Visualization Component
 * Displays the progress of Massively Decomposed Agentic Processes
 */

import React from 'react'
import { MDAPProgressUpdate } from '@shared/types'
import { useFocusedMDAPProgress, useMDAPStore } from '../stores/mdap-store'

interface MDAPSubtaskItemProps {
  index: number
  description: string
  status: 'pending' | 'voting' | 'completed' | 'failed'
  votingProgress?: {
    leadingAnswer?: string
    leadMargin: number
    totalSamples: number
    targetMargin: number
    uniqueAnswers: number
  }
  winningAnswer?: string
  isCurrent: boolean
}

function MDAPSubtaskItem({
  index,
  description,
  status,
  votingProgress,
  winningAnswer,
  isCurrent,
}: MDAPSubtaskItemProps) {
  const statusColors = {
    pending: 'text-gray-400',
    voting: 'text-blue-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
  }

  const statusIcons = {
    pending: '○',
    voting: '◐',
    completed: '●',
    failed: '✗',
  }

  return (
    <div
      className={`p-3 rounded-lg mb-2 ${
        isCurrent ? 'bg-blue-500/20 border border-blue-500/40' : 'bg-gray-800/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-lg ${statusColors[status]}`}>
          {statusIcons[status]}
        </span>
        <span className="text-sm text-gray-300 font-medium">
          Step {index + 1}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded ${
          status === 'voting' ? 'bg-blue-500/30 text-blue-300' :
          status === 'completed' ? 'bg-green-500/30 text-green-300' :
          status === 'failed' ? 'bg-red-500/30 text-red-300' :
          'bg-gray-500/30 text-gray-400'
        }`}>
          {status}
        </span>
      </div>

      <p className="text-sm text-gray-400 mt-1 line-clamp-2">
        {description}
      </p>

      {status === 'voting' && votingProgress && (
        <div className="mt-2 p-2 bg-gray-900/50 rounded">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Voting Progress</span>
            <span>{votingProgress.leadMargin}/{votingProgress.targetMargin} lead</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, (votingProgress.leadMargin / votingProgress.targetMargin) * 100)}%`
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>{votingProgress.totalSamples} samples</span>
            <span>{votingProgress.uniqueAnswers} unique answers</span>
          </div>
        </div>
      )}

      {status === 'completed' && winningAnswer && (
        <div className="mt-2 p-2 bg-green-900/20 rounded text-xs text-green-300 line-clamp-2">
          {winningAnswer}
        </div>
      )}
    </div>
  )
}

interface MDAPProgressProps {
  progress?: MDAPProgressUpdate | null
  compact?: boolean
}

export function MDAPProgress({ progress, compact = false }: MDAPProgressProps) {
  const storeProgress = useFocusedMDAPProgress()
  const displayProgress = progress || storeProgress

  if (!displayProgress) {
    return null
  }

  const {
    taskDescription,
    totalSubtasks,
    completedSubtasks,
    currentSubtask,
    stateChain,
    isComplete,
    finalResult,
    error,
    statistics,
  } = displayProgress

  const percentComplete = totalSubtasks > 0
    ? Math.round((completedSubtasks / totalSubtasks) * 100)
    : 0

  if (compact) {
    return (
      <div className="p-3 bg-gray-900/80 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-300">
            MDAP Progress
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            isComplete
              ? error ? 'bg-red-500/30 text-red-300' : 'bg-green-500/30 text-green-300'
              : 'bg-blue-500/30 text-blue-300'
          }`}>
            {isComplete ? (error ? 'Failed' : 'Complete') : 'Processing'}
          </span>
        </div>

        <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              error ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${percentComplete}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-gray-400">
          <span>{completedSubtasks}/{totalSubtasks} subtasks</span>
          <span>{statistics.totalLLMCalls} LLM calls</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 bg-gray-900/80 rounded-lg border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium text-gray-200">
            MDAP Execution
          </h3>
          <p className="text-sm text-gray-400 line-clamp-1">
            {taskDescription}
          </p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full ${
          isComplete
            ? error ? 'bg-red-500/30 text-red-300' : 'bg-green-500/30 text-green-300'
            : 'bg-blue-500/30 text-blue-300'
        }`}>
          {isComplete ? (error ? 'Failed' : 'Complete') : 'Processing'}
        </span>
      </div>

      {/* Overall Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-400 mb-1">
          <span>Overall Progress</span>
          <span>{percentComplete}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${
              error ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${percentComplete}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{completedSubtasks} of {totalSubtasks} subtasks completed</span>
          <span>{statistics.elapsedMs}ms elapsed</span>
        </div>
      </div>

      {/* Current Subtask */}
      {currentSubtask && !isComplete && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-300 mb-2">
            Current Subtask
          </h4>
          <MDAPSubtaskItem
            index={currentSubtask.index}
            description={currentSubtask.description}
            status={currentSubtask.status}
            votingProgress={currentSubtask.votingProgress}
            winningAnswer={currentSubtask.winningAnswer}
            isCurrent={true}
          />
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="p-2 bg-gray-800/50 rounded text-center">
          <div className="text-lg font-semibold text-gray-200">
            {statistics.totalLLMCalls}
          </div>
          <div className="text-xs text-gray-500">LLM Calls</div>
        </div>
        <div className="p-2 bg-gray-800/50 rounded text-center">
          <div className="text-lg font-semibold text-gray-200">
            {statistics.totalVotes}
          </div>
          <div className="text-xs text-gray-500">Total Votes</div>
        </div>
        <div className="p-2 bg-gray-800/50 rounded text-center">
          <div className="text-lg font-semibold text-red-400">
            {statistics.totalRedFlags}
          </div>
          <div className="text-xs text-gray-500">Red Flags</div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-500/40 rounded-lg text-red-300 text-sm mb-4">
          <div className="font-medium mb-1">Error</div>
          <div>{error}</div>
        </div>
      )}

      {/* Final Result */}
      {isComplete && finalResult && !error && (
        <div className="p-3 bg-green-900/20 border border-green-500/40 rounded-lg">
          <div className="text-sm font-medium text-green-300 mb-1">
            Final Result
          </div>
          <div className="text-sm text-green-200 whitespace-pre-wrap">
            {finalResult}
          </div>
        </div>
      )}

      {/* State Chain (collapsible) */}
      {stateChain.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
            State Chain ({stateChain.length} states)
          </summary>
          <div className="mt-2 space-y-1">
            {stateChain.map((state, idx) => (
              <div
                key={idx}
                className="p-2 bg-gray-800/30 rounded text-xs text-gray-400 line-clamp-2"
              >
                <span className="font-medium text-gray-500">
                  State {idx}:
                </span>{' '}
                {state}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/**
 * MDAP Sessions List Component
 * Shows all active and completed MDAP sessions
 */
export function MDAPSessionsList() {
  const { getAllMdapSessions, setFocusedMdapSession, focusedMdapSessionId } = useMDAPStore()
  const sessions = getAllMdapSessions()

  if (sessions.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No MDAP sessions
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <button
          key={session.sessionId}
          onClick={() => setFocusedMdapSession(session.sessionId)}
          className={`w-full p-3 rounded-lg text-left transition-colors ${
            focusedMdapSessionId === session.sessionId
              ? 'bg-blue-500/20 border border-blue-500/40'
              : 'bg-gray-800/50 hover:bg-gray-800/70'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300 truncate flex-1">
              {session.taskDescription.substring(0, 50)}
              {session.taskDescription.length > 50 ? '...' : ''}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ml-2 ${
              session.isComplete
                ? session.error ? 'bg-red-500/30 text-red-300' : 'bg-green-500/30 text-green-300'
                : 'bg-blue-500/30 text-blue-300'
            }`}>
              {session.isComplete ? (session.error ? 'Failed' : 'Done') : 'Running'}
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{session.completedSubtasks}/{session.totalSubtasks} steps</span>
            <span>{session.statistics.totalLLMCalls} calls</span>
          </div>
        </button>
      ))}
    </div>
  )
}

export default MDAPProgress
