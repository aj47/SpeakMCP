import React, { useState, useRef, useEffect } from 'react'
import type { AgentProgressUpdate, AgentProgressStep } from '../../shared/types'

interface AgentProgressViewerProps {
  progress: AgentProgressUpdate | null
  onClearProgress: () => void
  onSimulateAgent: (transcript: string) => void
}

export const AgentProgressViewer: React.FC<AgentProgressViewerProps> = ({
  progress,
  onClearProgress,
  onSimulateAgent
}) => {
  const [simulationInput, setSimulationInput] = useState('')
  const [isSimulating, setIsSimulating] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [progress?.steps])

  const handleSimulate = async () => {
    if (!simulationInput.trim()) return
    
    setIsSimulating(true)
    try {
      await onSimulateAgent(simulationInput.trim())
    } finally {
      setIsSimulating(false)
    }
  }

  const getStepIcon = (step: AgentProgressStep) => {
    switch (step.type) {
      case 'thinking':
        return (
          <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
        )
      case 'tool_call':
        return (
          <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        )
      case 'tool_result':
        return (
          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
            step.status === 'error' 
              ? 'bg-red-100 dark:bg-red-900' 
              : 'bg-green-100 dark:bg-green-900'
          }`}>
            <svg className={`w-4 h-4 ${
              step.status === 'error' 
                ? 'text-red-600 dark:text-red-400' 
                : 'text-green-600 dark:text-green-400'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {step.status === 'error' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              )}
            </svg>
          </div>
        )
      case 'completion':
        return (
          <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-gray-400"></div>
          </div>
        )
    }
  }

  const getStatusColor = (status: AgentProgressStep['status']) => {
    switch (status) {
      case 'pending':
        return 'text-gray-500 dark:text-gray-400'
      case 'in_progress':
        return 'text-blue-600 dark:text-blue-400'
      case 'completed':
        return 'text-green-600 dark:text-green-400'
      case 'error':
        return 'text-red-600 dark:text-red-400'
      default:
        return 'text-gray-500 dark:text-gray-400'
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Agent Progress Viewer
        </h2>
        <div className="flex space-x-2">
          {progress && (
            <button
              onClick={onClearProgress}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Clear Progress
            </button>
          )}
        </div>
      </div>

      {/* Simulation Input */}
      <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Simulate Agent Mode
        </h3>
        <div className="space-y-3">
          <textarea
            value={simulationInput}
            onChange={(e) => setSimulationInput(e.target.value)}
            placeholder="Enter a request to simulate agent mode processing..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
            disabled={isSimulating}
          />
          <button
            onClick={handleSimulate}
            disabled={!simulationInput.trim() || isSimulating}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-700"
          >
            {isSimulating ? 'Simulating...' : 'Simulate Agent Mode'}
          </button>
        </div>
      </div>

      {/* Progress Display */}
      {progress ? (
        <div className="space-y-6">
          {/* Progress Header */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Agent Processing
              </h3>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Iteration {progress.currentIteration} of {progress.maxIterations}
                </span>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  progress.isComplete 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                }`}>
                  {progress.isComplete ? 'Complete' : 'Processing'}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (progress.currentIteration / progress.maxIterations) * 100)}%`
                }}
              />
            </div>
          </div>

          {/* Steps Timeline */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="text-md font-medium text-gray-900 dark:text-white mb-4">
              Processing Steps
            </h4>
            <div 
              ref={scrollContainerRef}
              className="space-y-4 max-h-96 overflow-y-auto"
            >
              {progress.steps.map((step, index) => (
                <div key={step.id} className="flex items-start space-x-3">
                  {/* Step Icon */}
                  <div className="flex-shrink-0 mt-1">
                    {getStepIcon(step)}
                  </div>

                  {/* Step Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                        {step.title}
                      </h5>
                      <span className={`text-xs font-medium capitalize ${getStatusColor(step.status)}`}>
                        {step.status.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatTimestamp(step.timestamp)}
                      </span>
                    </div>

                    {step.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {step.description}
                      </p>
                    )}

                    {/* LLM Content */}
                    {step.llmContent && (
                      <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <h6 className="text-xs font-medium text-blue-800 dark:text-blue-200 mb-1">
                          LLM Response:
                        </h6>
                        <p className="text-sm text-blue-700 dark:text-blue-300 whitespace-pre-wrap">
                          {step.llmContent}
                        </p>
                      </div>
                    )}

                    {/* Tool Call */}
                    {step.toolCall && (
                      <div className="mt-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <h6 className="text-xs font-medium text-purple-800 dark:text-purple-200 mb-1">
                          Tool Call: {step.toolCall.name}
                        </h6>
                        <pre className="text-xs text-purple-700 dark:text-purple-300 overflow-x-auto">
                          {JSON.stringify(step.toolCall.arguments, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Tool Result */}
                    {step.toolResult && (
                      <div className={`mt-2 p-3 rounded-lg ${
                        step.toolResult.success
                          ? 'bg-green-50 dark:bg-green-900/20'
                          : 'bg-red-50 dark:bg-red-900/20'
                      }`}>
                        <h6 className={`text-xs font-medium mb-1 ${
                          step.toolResult.success
                            ? 'text-green-800 dark:text-green-200'
                            : 'text-red-800 dark:text-red-200'
                        }`}>
                          Tool Result: {step.toolResult.success ? 'Success' : 'Error'}
                        </h6>
                        <p className={`text-sm whitespace-pre-wrap ${
                          step.toolResult.success
                            ? 'text-green-700 dark:text-green-300'
                            : 'text-red-700 dark:text-red-300'
                        }`}>
                          {step.toolResult.error || step.toolResult.content}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Final Content */}
          {progress.isComplete && progress.finalContent && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h4 className="text-md font-medium text-gray-900 dark:text-white mb-3">
                Final Result
              </h4>
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <p className="text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap">
                  {progress.finalContent}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12">
          <p className="text-lg mb-2">No agent progress to display</p>
          <p className="text-sm">Use the simulation input above to start an agent mode simulation.</p>
        </div>
      )}
    </div>
  )
}
