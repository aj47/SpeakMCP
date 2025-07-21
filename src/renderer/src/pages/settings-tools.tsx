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

CRITICAL: When calling tools, you MUST use the EXACT tool name as listed in the available tools, including any server prefixes (like "server:tool_name"). Do not modify or shorten the tool names. NEVER invent or hallucinate tool names that are not in the list.

TOOL USAGE PATTERNS:
For file system operations (like listing directories, checking desktop contents):
1. Use "Headless Terminal:ht_create_session" to create a terminal session
2. Use "Headless Terminal:ht_execute_command" with commands like "ls ~/Desktop", "ls -la /path/to/directory", "pwd", etc.

For web operations:
- Use any available web/search tools if present in the list

For system operations:
- Use terminal commands via "Headless Terminal:ht_execute_command" for system tasks

ALWAYS prefer using available tools over suggesting manual approaches. If you can accomplish the task with the available tools, do it!

When the user's request requires using a tool, respond with a JSON object in this format:
{
  "toolCalls": [
    {
      "name": "exact_tool_name_from_available_list",
      "arguments": { "param1": "value1", "param2": "value2" }
    }
  ],
  "content": "Brief explanation of what you're doing"
}

If no tools are needed, respond with:
{
  "content": "Your response text here"
}

Examples:

User: "List the contents of my desktop"
Response:
{
  "toolCalls": [
    {
      "name": "Headless Terminal:ht_create_session",
      "arguments": {}
    }
  ],
  "content": "Creating a terminal session to list your desktop contents"
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

              <div className="flex items-center space-x-2">
                <Switch
                  id="mcp-agent-mode"
                  checked={config.mcpAgentModeEnabled || false}
                  onCheckedChange={(checked) => updateConfig({ mcpAgentModeEnabled: checked })}
                />
                <Label htmlFor="mcp-agent-mode">Enable Agent Mode</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, the agent can see tool results and make follow-up tool calls until the task is complete
              </p>

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
                        <SelectItem value="moonshotai/kimi-k2-instruct">Moonshot AI Kimi K2 Instruct</SelectItem>
                        <SelectItem value="deepseek-r1-distill-llama-70b">DeepSeek R1 Distill Llama 70B</SelectItem>
                        <SelectItem value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile</SelectItem>
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
                <h4 className="font-medium">MCP Tools</h4>
                <div className="text-sm text-muted-foreground">
                  <p>Tools are provided by MCP (Model Context Protocol) servers that you configure.</p>
                  <p className="mt-2">Configure MCP servers below to add tools for file operations, API integrations, and more.</p>
                </div>
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
