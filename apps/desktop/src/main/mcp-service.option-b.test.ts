import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

let currentConfig: any
let currentProfileEnabledBuiltinTools: string[] | undefined

const mockConfigSave = vi.fn()
const mockSaveCurrentMcpStateToProfile = vi.fn()
const mockExecuteBuiltinTool = vi.fn(async (name: string) => ({ content: [{ type: "text", text: `ran ${name}` }], isError: false }))

const builtinTools = [
  { name: "speakmcp-settings:mark_work_complete", description: "essential", inputSchema: {} },
  { name: "speakmcp-settings:save_memory", description: "save", inputSchema: {} },
  { name: "speakmcp-settings:list_memories", description: "list", inputSchema: {} },
]

vi.mock("electron", () => ({ app: { getPath: vi.fn(() => "/tmp"), getAppPath: vi.fn(() => "/tmp/app") }, dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) } }))
vi.mock("./config", () => ({ dataFolder: "/tmp/speakmcp-test", configStore: { get: () => currentConfig, save: mockConfigSave } }))
vi.mock("./debug", () => ({ isDebugTools: () => false, logTools: vi.fn(), logMCP: vi.fn() }))
vi.mock("./diagnostics", () => ({ diagnosticsService: { logError: vi.fn(), logWarning: vi.fn(), logInfo: vi.fn() } }))
vi.mock("./state", () => ({ state: {}, agentProcessManager: {} }))
vi.mock("./oauth-client", () => ({ OAuthClient: class {} }))
vi.mock("./oauth-storage", () => ({ oauthStorage: {} }))
vi.mock("./mcp-elicitation", () => ({ requestElicitation: vi.fn(), handleElicitationComplete: vi.fn(), cancelAllElicitations: vi.fn() }))
vi.mock("./mcp-sampling", () => ({ requestSampling: vi.fn(), cancelAllSamplingRequests: vi.fn() }))
vi.mock("./langfuse-service", () => ({ isLangfuseEnabled: vi.fn(() => false), createToolSpan: vi.fn(), endToolSpan: vi.fn(), getAgentTrace: vi.fn(() => null) }))
vi.mock("./agent-profile-service", () => ({ agentProfileService: { getCurrentProfile: () => ({ id: "profile_1", toolConfig: { enabledBuiltinTools: currentProfileEnabledBuiltinTools } }), saveCurrentMcpStateToProfile: mockSaveCurrentMcpStateToProfile } }))
vi.mock("./builtin-tools", () => ({ BUILTIN_SERVER_NAME: "speakmcp-settings", builtinTools, isBuiltinTool: (n: string) => n.startsWith("speakmcp-settings:") || n.startsWith("speakmcp-builtin:"), executeBuiltinTool: mockExecuteBuiltinTool }))

const flushPromises = async (): Promise<void> => {
  await Promise.resolve(); await Promise.resolve()
}

describe("MCPService Option B (builtin allowlist)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()

    vi.clearAllMocks()

    currentProfileEnabledBuiltinTools = undefined
    currentConfig = {
      mcpRequireApprovalBeforeToolCall: false,
      mcpConfig: { mcpServers: {} },
      mcpRuntimeDisabledServers: [],
      mcpDisabledTools: [],
    }
  })

  afterEach(() => {
    vi.clearAllTimers(); vi.useRealTimers()
  })

  it("ignores built-in entries in persisted mcpDisabledTools", async () => {
    currentConfig.mcpDisabledTools = ["speakmcp-settings:save_memory", "server:external_tool"]
    const { mcpService } = await import("./mcp-service")
    expect(mcpService.getDisabledTools()).toEqual(["server:external_tool"])
  })

  it("applyProfileMcpConfig ignores builtins in disabledTools and persists only external", async () => {
    const { mcpService } = await import("./mcp-service")
    mockConfigSave.mockClear()

    mcpService.applyProfileMcpConfig(undefined, ["speakmcp-settings:list_memories", "server:external_tool"], false, undefined, undefined)

    expect(mcpService.getDisabledTools()).toEqual(["server:external_tool"])
    expect(mockConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({ mcpDisabledTools: ["server:external_tool"] }),
    )
  })

  it("getAvailableTools filters builtin tools by enabledBuiltinTools allowlist (essential always included)", async () => {
    const { mcpService } = await import("./mcp-service")

    mcpService.applyProfileMcpConfig(undefined, undefined, false, undefined, ["speakmcp-settings:save_memory"])

    expect(mcpService.getAvailableTools().map((t) => t.name)).toEqual([
      "speakmcp-settings:mark_work_complete",
      "speakmcp-settings:save_memory",
    ])

    const detailed = mcpService.getDetailedToolList()
    expect(detailed.find((t) => t.name === "speakmcp-settings:mark_work_complete")?.enabled).toBe(true)
    expect(detailed.find((t) => t.name === "speakmcp-settings:save_memory")?.enabled).toBe(true)
    expect(detailed.find((t) => t.name === "speakmcp-settings:list_memories")?.enabled).toBe(false)
  })

  it("setToolEnabled(builtin) updates allowlist and auto-saves to profile without touching mcpDisabledTools", async () => {
    const { mcpService } = await import("./mcp-service")
    mockConfigSave.mockClear()
    mockSaveCurrentMcpStateToProfile.mockClear()

    expect(mcpService.setToolEnabled("speakmcp-settings:list_memories", false)).toBe(true)
    expect(mockConfigSave).not.toHaveBeenCalled()

    await flushPromises()
    expect(mockSaveCurrentMcpStateToProfile).toHaveBeenCalledTimes(1)
    const enabledBuiltinTools = mockSaveCurrentMcpStateToProfile.mock.calls[0][4] as string[]
    expect(enabledBuiltinTools).toEqual([
      "speakmcp-settings:mark_work_complete",
      "speakmcp-settings:save_memory",
    ])
  })

  it("executeToolCall rejects disabled builtins but allows essential builtins", async () => {
    const { mcpService } = await import("./mcp-service")
    mockExecuteBuiltinTool.mockClear()

    mcpService.applyProfileMcpConfig(undefined, undefined, false, undefined, ["speakmcp-settings:save_memory"])

    const denied = await mcpService.executeToolCall(
      { name: "speakmcp-settings:list_memories", arguments: {} } as any,
      undefined,
      true,
    )
    expect(denied.isError).toBe(true)
    expect(mockExecuteBuiltinTool).not.toHaveBeenCalled()

    const ok = await mcpService.executeToolCall(
      { name: "speakmcp-settings:mark_work_complete", arguments: {} } as any,
      undefined,
      true,
    )
    expect(ok.isError).toBe(false)
    expect(mockExecuteBuiltinTool).toHaveBeenCalledTimes(1)
  })
})

