import React, { useState, useEffect } from "react"
import { tipcClient } from "../lib/tipc-client"

interface DiagnosticInfo {
  timestamp: number
  system: {
    platform: string
    nodeVersion: string
    electronVersion: string
  }
  config: {
    mcpServersCount: number
    mcpToolsEnabled: boolean
    mcpAgentModeEnabled: boolean
  }
  mcp: {
    availableTools: number
    activeSessions: Array<{
      serverId: string
      sessionId: string
      lastUsed: number
    }>
    serverStatus: Record<string, { connected: boolean; toolCount: number }>
  }
  errors: Array<{
    timestamp: number
    level: "error" | "warning" | "info"
    component: string
    message: string
    stack?: string
  }>
}

interface HealthCheck {
  overall: "healthy" | "warning" | "critical"
  checks: Record<
    string,
    { status: "pass" | "fail" | "warning"; message: string }
  >
}

export function DiagnosticsPanel() {
  const [diagnosticInfo, setDiagnosticInfo] = useState<DiagnosticInfo | null>(
    null,
  )
  const [healthCheck, setHealthCheck] = useState<HealthCheck | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<
    "overview" | "errors" | "sessions"
  >("overview")

  const loadDiagnostics = async () => {
    setLoading(true)
    try {
      const [diagnostic, health] = await Promise.all([
        tipcClient.getDiagnosticReport(),
        tipcClient.performHealthCheck(),
      ])
      setDiagnosticInfo(diagnostic)
      setHealthCheck(health)
    } catch (error) {
    } finally {
      setLoading(false)
    }
  }

  const saveDiagnosticReport = async () => {
    try {
      const result = await tipcClient.saveDiagnosticReport({})
      if (result.success) {
        alert(`Diagnostic report saved to: ${result.filePath}`)
      } else {
        alert(`Failed to save report: ${result.error}`)
      }
    } catch (error) {
      alert(`Error saving report: ${error}`)
    }
  }

  const clearErrors = async () => {
    try {
      await tipcClient.clearErrorLog()
      loadDiagnostics() // Refresh data
    } catch (error) {}
  }

  useEffect(() => {
    loadDiagnostics()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-600">Loading diagnostics...</div>
      </div>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
      case "pass":
        return "text-green-600"
      case "warning":
        return "text-yellow-600"
      case "critical":
      case "fail":
        return "text-red-600"
      default:
        return "text-gray-600"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
      case "pass":
        return "✅"
      case "warning":
        return "⚠️"
      case "critical":
      case "fail":
        return "❌"
      default:
        return "❓"
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">System Diagnostics</h1>
        <div className="space-x-2">
          <button
            onClick={loadDiagnostics}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Refresh
          </button>
          <button
            onClick={saveDiagnosticReport}
            className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
          >
            Save Report
          </button>
        </div>
      </div>

      {/* Health Status */}
      {healthCheck && (
        <div className="mb-6 rounded-lg border p-4">
          <div className="mb-3 flex items-center">
            <span className="mr-2 text-lg">
              {getStatusIcon(healthCheck.overall)}
            </span>
            <h2 className="text-lg font-semibold">
              Overall Status:
              <span className={`ml-2 ${getStatusColor(healthCheck.overall)}`}>
                {healthCheck.overall.toUpperCase()}
              </span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Object.entries(healthCheck.checks).map(([check, result]) => (
              <div key={check} className="flex items-center">
                <span className="mr-2">{getStatusIcon(result.status)}</span>
                <div>
                  <div className="font-medium">{check}</div>
                  <div className="text-sm text-gray-600">{result.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="mb-4 border-b">
        <nav className="flex space-x-8">
          {[
            { id: "overview", label: "Overview" },
            { id: "errors", label: "Errors" },
            { id: "sessions", label: "Sessions" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`border-b-2 px-1 py-2 text-sm font-medium ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {diagnosticInfo && (
        <>
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <h3 className="mb-3 font-semibold">System Information</h3>
                  <div className="space-y-2 text-sm">
                    <div>Platform: {diagnosticInfo.system.platform}</div>
                    <div>Node.js: {diagnosticInfo.system.nodeVersion}</div>
                    <div>Electron: {diagnosticInfo.system.electronVersion}</div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <h3 className="mb-3 font-semibold">Configuration</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      MCP Servers: {diagnosticInfo.config.mcpServersCount}
                    </div>
                    <div>
                      Tools Enabled:{" "}
                      {diagnosticInfo.config.mcpToolsEnabled ? "Yes" : "No"}
                    </div>
                    <div>
                      Agent Mode:{" "}
                      {diagnosticInfo.config.mcpAgentModeEnabled ? "Yes" : "No"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="mb-3 font-semibold">MCP Status</h3>
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
                  <div>
                    Available Tools: {diagnosticInfo.mcp.availableTools}
                  </div>
                  <div>
                    Active Sessions: {diagnosticInfo.mcp.activeSessions.length}
                  </div>
                  <div>
                    Connected Servers:{" "}
                    {
                      Object.values(diagnosticInfo.mcp.serverStatus).filter(
                        (s) => s.connected,
                      ).length
                    }
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "errors" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Recent Errors ({diagnosticInfo.errors.length})
                </h3>
                <button
                  onClick={clearErrors}
                  className="rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600"
                >
                  Clear All
                </button>
              </div>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {diagnosticInfo.errors.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
                    No errors recorded
                  </div>
                ) : (
                  diagnosticInfo.errors
                    .slice()
                    .reverse()
                    .map((error, index) => (
                      <div key={index} className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="mr-2">
                              {error.level === "error"
                                ? "❌"
                                : error.level === "warning"
                                  ? "⚠️"
                                  : "ℹ️"}
                            </span>
                            <span className="font-medium">
                              {error.component}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(error.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-sm text-gray-700">
                          {error.message}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {activeTab === "sessions" && (
            <div className="space-y-4">
              <h3 className="font-semibold">
                Active Sessions ({diagnosticInfo.mcp.activeSessions.length})
              </h3>
              <div className="space-y-2">
                {diagnosticInfo.mcp.activeSessions.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
                    No active sessions
                  </div>
                ) : (
                  diagnosticInfo.mcp.activeSessions.map((session, index) => (
                    <div key={index} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{session.serverId}</div>
                          <div className="text-sm text-gray-600">
                            ID: {session.sessionId}
                          </div>
                        </div>
                        <div className="text-sm text-gray-500">
                          Last used:{" "}
                          {new Date(session.lastUsed).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
