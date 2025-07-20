import { useConfigQuery } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Textarea } from "@renderer/components/ui/textarea"

import { CHAT_PROVIDERS } from "@shared/index"
import { Config, MCPConfig } from "@shared/types"
import { MCPConfigManager } from "@renderer/components/mcp-config-manager"
import { MCPToolManager } from "@renderer/components/mcp-tool-manager"

export function Component() {
  const configQuery = useConfigQuery()
  const queryClient = useQueryClient()

  const saveConfigMutation = useMutation({
    mutationFn: async (config: Config) => {
      await tipcClient.saveConfig({ config })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
    },
  })

  const config = configQuery.data || {}

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates }
    saveConfigMutation.mutate(newConfig)
  }

  const updateMcpConfig = (mcpConfig: MCPConfig) => {
    updateConfig({ mcpConfig })
  }

  const defaultSystemPrompt = `You are a helpful assistant that can execute tools based on user requests.

When the user's request requires using a tool, respond with a JSON object in this format:
{
  "toolCalls": [
    {
      "name": "tool_name",
      "arguments": { "param1": "value1", "param2": "value2" }
    }
  ],
  "content": "Optional explanation of what you're doing"
}

If no tools are needed, respond with:
{
  "content": "Your response text here"
}

Always respond with valid JSON only.`

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">MCP Tool Calling</h3>
          <p className="text-sm text-muted-foreground">
            Enable voice-activated tool execution using Model Context Protocol (MCP).
            This allows you to perform actions like creating files, sending notifications, and more through voice commands.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="mcp-enabled"
              checked={config.mcpToolsEnabled || false}
              onCheckedChange={(checked) => updateConfig({ mcpToolsEnabled: checked })}
            />
            <Label htmlFor="mcp-enabled">Enable MCP Tool Calling</Label>
          </div>

          {config.mcpToolsEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-shortcut">Shortcut</Label>
                <Select
                  value={config.mcpToolsShortcut || "hold-ctrl-alt"}
                  onValueChange={(value: "hold-ctrl-alt" | "ctrl-alt-slash") =>
                    updateConfig({ mcpToolsShortcut: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hold-ctrl-alt">Hold Ctrl+Alt</SelectItem>
                    <SelectItem value="ctrl-alt-slash">Ctrl+Alt+/</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose how to activate MCP tool calling mode
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mcp-provider">LLM Provider</Label>
                <Select
                  value={config.mcpToolsProviderId || "openai"}
                  onValueChange={(value) => updateConfig({ mcpToolsProviderId: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAT_PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose which LLM provider to use for tool calling decisions
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {config.mcpToolsProviderId === "openai" && (
                  <div className="space-y-2">
                    <Label htmlFor="mcp-openai-model">OpenAI Model</Label>
                    <Select
                      value={config.mcpToolsOpenaiModel || "gpt-4o-mini"}
                      onValueChange={(value) => updateConfig({ mcpToolsOpenaiModel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                        <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                        <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                        <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {config.mcpToolsProviderId === "groq" && (
                  <div className="space-y-2">
                    <Label htmlFor="mcp-groq-model">Groq Model</Label>
                    <Select
                      value={config.mcpToolsGroqModel || "gemma2-9b-it"}
                      onValueChange={(value) => updateConfig({ mcpToolsGroqModel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemma2-9b-it">Gemma2 9B IT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {config.mcpToolsProviderId === "gemini" && (
                  <div className="space-y-2">
                    <Label htmlFor="mcp-gemini-model">Gemini Model</Label>
                    <Select
                      value={config.mcpToolsGeminiModel || "gemini-1.5-flash-002"}
                      onValueChange={(value) => updateConfig({ mcpToolsGeminiModel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini-1.5-flash-002">Gemini 1.5 Flash</SelectItem>
                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                        <SelectItem value="gemini-1.0-pro">Gemini 1.0 Pro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="mcp-system-prompt">System Prompt</Label>
                <Textarea
                  id="mcp-system-prompt"
                  value={config.mcpToolsSystemPrompt || defaultSystemPrompt}
                  onChange={(e) => updateConfig({ mcpToolsSystemPrompt: e.target.value })}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Instructions for the LLM on how to use tools. The system will automatically include available tools in the prompt.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateConfig({ mcpToolsSystemPrompt: defaultSystemPrompt })}
                >
                  Reset to Default
                </Button>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="font-medium">Available Tools</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>• <strong>create_file</strong> - Create new files with specified content</div>
                  <div>• <strong>read_file</strong> - Read contents of existing files</div>
                  <div>• <strong>list_files</strong> - List files in a directory</div>
                  <div>• <strong>send_notification</strong> - Send system notifications</div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  More tools can be added in future updates or through MCP server integrations.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Agent Chaining Configuration Section */}
        <div className="mt-8 pt-6 border-t space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-4">Agent Chaining</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Configure agent chaining to enable multi-step task execution with automatic tool calling and reasoning.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="agent-chaining-enabled">Enable Agent Chaining</Label>
              <p className="text-sm text-muted-foreground">
                Allow agents to chain multiple tool calls and LLM interactions to complete complex tasks
              </p>
            </div>
            <Switch
              id="agent-chaining-enabled"
              checked={config.agentChainingEnabled || false}
              onCheckedChange={(checked) => updateConfig({ agentChainingEnabled: checked })}
            />
          </div>

          {config.agentChainingEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="agent-chaining-shortcut">Keyboard Shortcut</Label>
                <Select
                  value={config.agentChainingShortcut || "hold-ctrl-shift"}
                  onValueChange={(value: "hold-ctrl-shift" | "ctrl-shift-slash") =>
                    updateConfig({ agentChainingShortcut: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hold-ctrl-shift">Hold Ctrl+Shift</SelectItem>
                    <SelectItem value="ctrl-shift-slash">Ctrl+Shift+/</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agent-chaining-provider">LLM Provider</Label>
                <Select
                  value={config.agentChainingProviderId || "groq"}
                  onValueChange={(value) => updateConfig({ agentChainingProviderId: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAT_PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-chaining-openai-model">OpenAI Model</Label>
                  <Select
                    value={config.agentChainingOpenaiModel || "gpt-4o-mini"}
                    onValueChange={(value) => updateConfig({ agentChainingOpenaiModel: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                      <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                      <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-chaining-groq-model">Groq Model</Label>
                  <Select
                    value={config.agentChainingGroqModel || "gemma2-9b-it"}
                    onValueChange={(value) => updateConfig({ agentChainingGroqModel: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemma2-9b-it">Gemma2 9B IT</SelectItem>
                      <SelectItem value="llama-3.1-70b-versatile">Llama 3.1 70B</SelectItem>
                      <SelectItem value="llama-3.1-8b-instant">Llama 3.1 8B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-chaining-gemini-model">Gemini Model</Label>
                  <Select
                    value={config.agentChainingGeminiModel || "gemini-1.5-flash-002"}
                    onValueChange={(value) => updateConfig({ agentChainingGeminiModel: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-1.5-flash-002">Gemini 1.5 Flash</SelectItem>
                      <SelectItem value="gemini-1.5-pro-002">Gemini 1.5 Pro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-chaining-max-steps">Max Steps</Label>
                  <Select
                    value={String(config.agentChainingMaxSteps || 10)}
                    onValueChange={(value) => updateConfig({ agentChainingMaxSteps: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 steps</SelectItem>
                      <SelectItem value="10">10 steps</SelectItem>
                      <SelectItem value="15">15 steps</SelectItem>
                      <SelectItem value="20">20 steps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-chaining-timeout">Timeout (minutes)</Label>
                  <Select
                    value={String(config.agentChainingTimeoutMinutes || 10)}
                    onValueChange={(value) => updateConfig({ agentChainingTimeoutMinutes: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 minutes</SelectItem>
                      <SelectItem value="10">10 minutes</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="agent-chaining-system-prompt">System Prompt</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateConfig({
                      agentChainingSystemPrompt: `You are an intelligent agent that can execute multiple steps to accomplish complex goals.

You have access to various tools that can help you complete tasks. Analyze the user's goal, break it down into steps, and execute them systematically.

For each step:
1. Analyze what needs to be done
2. Use appropriate tools if needed
3. Evaluate the results
4. Decide whether to continue or if the goal is complete

Be thorough but efficient. Always explain your reasoning and next steps clearly.

When you believe the goal is complete, end your response with "COMPLETE: [summary of what was accomplished]"
When you need to continue with more actions, end your response with "CONTINUE: [reason why you need to continue]"`
                    })}
                  >
                    Reset to Default
                  </Button>
                </div>
                <Textarea
                  id="agent-chaining-system-prompt"
                  value={config.agentChainingSystemPrompt || ""}
                  onChange={(e) => updateConfig({ agentChainingSystemPrompt: e.target.value })}
                  placeholder="Enter system prompt for agent chaining..."
                  rows={8}
                />
              </div>
            </>
          )}
        </div>

        {/* MCP Server Configuration Section */}
        {config.mcpToolsEnabled && (
          <div className="mt-8 pt-6 border-t space-y-8">
            <MCPConfigManager
              config={config.mcpConfig || { mcpServers: {} }}
              onConfigChange={updateMcpConfig}
            />

            {/* MCP Tool Management Section */}
            <div className="pt-6 border-t">
              <MCPToolManager />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
