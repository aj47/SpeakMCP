import { describe, it, expect, vi, afterEach } from "vitest"

type EffectRecord = {
  deps?: any[]
  nextDeps?: any[]
  callback?: () => void | (() => void)
  cleanup?: void | (() => void)
  hasRun: boolean
}

function createHookRuntime() {
  const states: any[] = []
  const setters: Array<(next: any) => void> = []
  const refs: Array<{ current: any }> = []
  const effects: EffectRecord[] = []

  let stateIndex = 0
  let refIndex = 0
  let effectIndex = 0

  const useState = <T,>(initial: T | (() => T)) => {
    const idx = stateIndex++
    if (states[idx] === undefined) {
      states[idx] = typeof initial === "function" ? (initial as any)() : initial
    }
    if (!setters[idx]) {
      setters[idx] = (update: any) => {
        const prev = states[idx]
        states[idx] = typeof update === "function" ? update(prev) : update
      }
    }
    return [states[idx] as T, setters[idx] as (next: T | ((prev: T) => T)) => void] as const
  }

  const useRef = <T,>(initial: T) => {
    const idx = refIndex++
    if (!refs[idx]) refs[idx] = { current: initial }
    return refs[idx] as { current: T }
  }

  const depsChanged = (prev: any[] | undefined, next: any[] | undefined) => {
    if (prev === undefined || next === undefined) return true
    if (prev.length !== next.length) return true
    for (let i = 0; i < prev.length; i++) {
      if (!Object.is(prev[i], next[i])) return true
    }
    return false
  }

  const useEffect = (callback: EffectRecord["callback"], deps?: any[]) => {
    const idx = effectIndex++
    const record = effects[idx] ?? { hasRun: false }
    record.callback = callback
    record.nextDeps = deps
    effects[idx] = record
  }

  const render = <P,>(Component: (props: P) => any, props: P) => {
    stateIndex = 0
    refIndex = 0
    effectIndex = 0
    return Component(props)
  }

  const commitEffects = (onlyEffectIndices?: number[]) => {
    const indices = onlyEffectIndices ?? effects.map((_, idx) => idx)
    for (const idx of indices) {
      const record = effects[idx]
      if (!record?.callback) continue
      const shouldRun = !record.hasRun || depsChanged(record.deps, record.nextDeps)
      if (!shouldRun) continue

      if (typeof record.cleanup === "function") record.cleanup()
      const cleanup = record.callback()
      record.cleanup = cleanup
      record.deps = record.nextDeps
      record.hasRun = true
    }
  }

  const cleanupAllEffects = () => {
    for (const record of effects) {
      if (record && typeof record.cleanup === "function") record.cleanup()
    }
  }

  const reactMock = {
    __esModule: true,
    default: {} as any,
    useState,
    useRef,
    useEffect,
  }
  reactMock.default = reactMock

  const jsxRuntimeMock = {
    __esModule: true,
    jsx: () => null,
    jsxs: () => null,
    Fragment: Symbol.for("react.fragment"),
  }

  return {
    render,
    commitEffects,
    cleanupAllEffects,
    reactMock,
    jsxRuntimeMock,
  }
}

async function loadMCPConfigManager(runtime: ReturnType<typeof createHookRuntime>) {
  await vi.resetModules()

  const Null = () => null

  vi.doMock("react", () => runtime.reactMock)
  vi.doMock("react/jsx-runtime", () => runtime.jsxRuntimeMock)

  // Use relative specifiers so the mock key matches the resolved file path even when the
  // component imports via tsconfig path aliases (e.g. @renderer/*).
  vi.doMock("../lib/tipc-client", () => ({ __esModule: true, tipcClient: {} }))
  vi.doMock("sonner", () => ({
    __esModule: true,
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }))

  vi.doMock("lucide-react", () => {
    const Icon = () => null
    // Explicit exports (no Proxy) to avoid accidentally creating a thenable (hanging imports)
    return {
      __esModule: true,
      Trash2: Icon,
      Edit: Icon,
      Plus: Icon,
      Upload: Icon,
      Download: Icon,
      Server: Icon,
      CheckCircle: Icon,
      XCircle: Icon,
      AlertCircle: Icon,
      BookOpen: Icon,
      RotateCcw: Icon,
      Square: Icon,
      Play: Icon,
      ExternalLink: Icon,
      FileText: Icon,
      ChevronDown: Icon,
      ChevronUp: Icon,
      ChevronRight: Icon,
      ChevronsUpDown: Icon,
      Terminal: Icon,
      Trash: Icon,
      Search: Icon,
      Eye: Icon,
      EyeOff: Icon,
      Power: Icon,
      PowerOff: Icon,
      Wrench: Icon,
    }
  })

  vi.doMock("./ui/button", () => ({ __esModule: true, Button: Null }))
  vi.doMock("./ui/input", () => ({ __esModule: true, Input: Null }))
  vi.doMock("./ui/label", () => ({ __esModule: true, Label: Null }))
  vi.doMock("./ui/textarea", () => ({ __esModule: true, Textarea: Null }))
  vi.doMock("./ui/switch", () => ({ __esModule: true, Switch: Null }))
  vi.doMock("./ui/badge", () => ({ __esModule: true, Badge: Null }))
  vi.doMock("./ui/spinner", () => ({ __esModule: true, Spinner: Null }))
  vi.doMock("./ui/card", () => ({
    __esModule: true,
    Card: Null,
    CardContent: Null,
    CardDescription: Null,
    CardHeader: Null,
    CardTitle: Null,
  }))
  vi.doMock("./ui/dialog", () => ({
    __esModule: true,
    Dialog: Null,
    DialogContent: Null,
    DialogDescription: Null,
    DialogFooter: Null,
    DialogHeader: Null,
    DialogTitle: Null,
    DialogTrigger: Null,
  }))
  vi.doMock("./ui/select", () => ({
    __esModule: true,
    Select: Null,
    SelectContent: Null,
    SelectItem: Null,
    SelectTrigger: Null,
    SelectValue: Null,
  }))
  vi.doMock("./OAuthServerConfig", () => ({ __esModule: true, OAuthServerConfig: Null }))
  vi.doMock("./ui/tooltip", () => ({
    __esModule: true,
    Tooltip: Null,
    TooltipContent: Null,
    TooltipProvider: Null,
    TooltipTrigger: Null,
  }))

  return import("./mcp-config-manager")
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("MCPConfigManager – hydration edge cases", () => {
	  it("persists a newly added server as collapsed when collapsedServers is [] and initial servers are empty", async () => {
    const runtime = createHookRuntime()
    const { MCPConfigManager } = await loadMCPConfigManager(runtime)

    const onCollapsedServersChange = vi.fn()

    const baseProps = {
      config: { mcpServers: {} },
      onConfigChange: vi.fn(),
      collapsedServers: [] as string[],
      onCollapsedServersChange,
    }

    runtime.render(MCPConfigManager, baseProps as any)
    runtime.commitEffects([0])
    expect(onCollapsedServersChange).not.toHaveBeenCalled()

    runtime.render(MCPConfigManager, {
      ...baseProps,
      config: { mcpServers: { "example-server": {} } },
    } as any)
    runtime.commitEffects([0])

    expect(onCollapsedServersChange).toHaveBeenCalledTimes(1)
    expect(onCollapsedServersChange).toHaveBeenCalledWith(["example-server"])
  })

  it("treats collapsedServers undefined as first-run (no persistence) and does not throw", async () => {
    const runtime = createHookRuntime()
    const { MCPConfigManager } = await loadMCPConfigManager(runtime)

    const onCollapsedServersChange = vi.fn()

    const baseProps = {
      config: { mcpServers: {} },
      onConfigChange: vi.fn(),
      collapsedServers: undefined as string[] | undefined,
      onCollapsedServersChange,
    }

    expect(() => runtime.render(MCPConfigManager, baseProps as any)).not.toThrow()
    runtime.commitEffects([0])

    expect(() =>
      runtime.render(
        MCPConfigManager,
        {
          ...baseProps,
          config: { mcpServers: { "example-server": {} } },
        } as any,
      ),
    ).not.toThrow()
    runtime.commitEffects([0])

    expect(onCollapsedServersChange).not.toHaveBeenCalled()
  })
})
