import React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { AgentChainConfig } from "@shared/types"
import { Bot, Settings, Clock, AlertTriangle } from "lucide-react"

interface AgentChainSettingsProps {
  config: AgentChainConfig
  onConfigChange: (config: AgentChainConfig) => void
}

export function AgentChainSettings({ config, onConfigChange }: AgentChainSettingsProps) {
  const updateConfig = (updates: Partial<AgentChainConfig>) => {
    onConfigChange({ ...config, ...updates })
  }

  const resetToDefaults = () => {
    const defaultConfig: AgentChainConfig = {
      enabled: true,
      maxIterations: 10,
      timeoutMs: 300000, // 5 minutes
      systemPrompt: `You are an autonomous AI agent that can execute tools to accomplish user goals.

IMPORTANT INSTRUCTIONS:
1. You will receive a high-level goal from the user
2. Break down the goal into actionable steps
3. Execute tools one at a time to accomplish the goal
4. After each tool execution, analyze the result and decide the next action
5. Continue until the goal is complete or you encounter an unrecoverable error

RESPONSE FORMAT:
You must respond with ONLY a valid JSON object in one of these formats:

For tool execution:
{
  "action": "execute_tool",
  "toolCall": {
    "name": "exact_tool_name",
    "arguments": { "param1": "value1" }
  },
  "reasoning": "Why you're executing this tool",
  "nextSteps": "What you plan to do after this"
}

For goal completion:
{
  "action": "complete",
  "reasoning": "Why the goal is now complete",
  "summary": "Summary of what was accomplished"
}

For error/failure:
{
  "action": "error",
  "reasoning": "What went wrong and why you cannot continue",
  "error": "Error description"
}

CRITICAL RULES:
- Use EXACT tool names from the available tools list
- Always provide clear reasoning for your decisions
- If a tool fails, try alternative approaches before giving up
- Keep track of what you've already tried to avoid loops
- Be efficient and focused on the user's goal`,
      enableProgressTracking: true
    }
    onConfigChange(defaultConfig)
  }

  const formatTimeout = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Agent Chain Configuration
          </CardTitle>
          <CardDescription>
            Configure autonomous agent chaining for complex task execution.
            Agent chains allow the AI to break down goals into steps and execute multiple tools automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="agent-chain-enabled">Enable Agent Chaining</Label>
              <p className="text-sm text-muted-foreground">
                Allow the AI to autonomously execute multiple tools to accomplish complex goals
              </p>
            </div>
            <Switch
              id="agent-chain-enabled"
              checked={config.enabled}
              onCheckedChange={(enabled) => updateConfig({ enabled })}
            />
          </div>

          {config.enabled && (
            <>
              {/* Safety Settings */}
              <div className="space-y-4 p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-200">Safety Settings</h4>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="max-iterations">Maximum Iterations</Label>
                    <Input
                      id="max-iterations"
                      type="number"
                      min="1"
                      max="50"
                      value={config.maxIterations}
                      onChange={(e) => updateConfig({ maxIterations: parseInt(e.target.value) || 10 })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum number of steps the agent can take (prevents infinite loops)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timeout">Timeout (minutes)</Label>
                    <Input
                      id="timeout"
                      type="number"
                      min="1"
                      max="60"
                      value={Math.floor(config.timeoutMs / 60000)}
                      onChange={(e) => updateConfig({ timeoutMs: (parseInt(e.target.value) || 5) * 60000 })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum execution time: {formatTimeout(config.timeoutMs)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress Tracking */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="progress-tracking">Enable Progress Tracking</Label>
                  <p className="text-sm text-muted-foreground">
                    Show real-time progress updates during chain execution
                  </p>
                </div>
                <Switch
                  id="progress-tracking"
                  checked={config.enableProgressTracking}
                  onCheckedChange={(enableProgressTracking) => updateConfig({ enableProgressTracking })}
                />
              </div>

              {/* System Prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="system-prompt">System Prompt</Label>
                  <Button variant="outline" size="sm" onClick={resetToDefaults}>
                    Reset to Default
                  </Button>
                </div>
                <Textarea
                  id="system-prompt"
                  value={config.systemPrompt}
                  onChange={(e) => updateConfig({ systemPrompt: e.target.value })}
                  rows={12}
                  className="font-mono text-sm"
                  placeholder="Enter the system prompt for the autonomous agent..."
                />
                <p className="text-xs text-muted-foreground">
                  This prompt guides how the agent makes decisions and executes tools. 
                  Be specific about the expected JSON response format.
                </p>
              </div>

              {/* Usage Instructions */}
              <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/20">
                <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">How to Use Agent Chaining</h4>
                <div className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
                  <p><strong>Keyboard Shortcut:</strong> Ctrl+Alt+Shift+/ to start agent chain recording</p>
                  <p><strong>Voice Command:</strong> Speak your high-level goal (e.g., "Create a new project folder and add a README file")</p>
                  <p><strong>Monitoring:</strong> Watch the progress tracker to see each step the agent takes</p>
                  <p><strong>Control:</strong> You can pause, resume, or stop the chain at any time</p>
                </div>
              </div>

              {/* Current Status */}
              <div className="flex items-center gap-2">
                <Badge variant={config.enabled ? "default" : "secondary"}>
                  {config.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant="outline">
                  Max {config.maxIterations} steps
                </Badge>
                <Badge variant="outline">
                  {formatTimeout(config.timeoutMs)} timeout
                </Badge>
                {config.enableProgressTracking && (
                  <Badge variant="outline">
                    Progress tracking
                  </Badge>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
