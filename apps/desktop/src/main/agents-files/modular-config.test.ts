import { describe, it, expect } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import type { Config } from "@shared/types"
import {
  findAgentsDirUpward,
  getAgentsLayerPaths,
  loadAgentsLayerConfig,
  loadMergedAgentsConfig,
  writeAgentsLayerFromConfig,
  writeAgentsPrompts,
} from "./modular-config"

const DEFAULT_PROMPT = "DEFAULT PROMPT\nLine2"

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8")
}

describe("modular-config", () => {
  it("loads layer config and normalizes default system prompt", () => {
    const dir = mkTempDir("speakmcp-modular-config-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)

    writeJson(layer.settingsJsonPath, { textInputEnabled: false })
    writeFile(
      layer.systemPromptMdPath,
      `---\nkind: system-prompt\n---\n\n${DEFAULT_PROMPT}\n`,
    )
    writeFile(layer.agentsMdPath, `---\nkind: agents\n---\n\nHello guidelines\n`)

    const loaded = loadAgentsLayerConfig(layer)
    expect(loaded.textInputEnabled).toBe(false)
  })

  it("merges workspace layer over global layer", () => {
    const dir = mkTempDir("speakmcp-modular-merge-")
    const globalAgentsDir = path.join(dir, "global", ".agents")
    const workspaceAgentsDir = path.join(dir, "workspace", ".agents")

    const globalLayer = getAgentsLayerPaths(globalAgentsDir)
    const workspaceLayer = getAgentsLayerPaths(workspaceAgentsDir)

    writeJson(globalLayer.settingsJsonPath, { textInputEnabled: false })
    writeJson(workspaceLayer.settingsJsonPath, { textInputEnabled: true })

    const { merged, hasAnyAgentsFiles } = loadMergedAgentsConfig(
      { globalAgentsDir, workspaceAgentsDir }
    )

    expect(hasAnyAgentsFiles).toBe(true)
    expect(merged.textInputEnabled).toBe(true)
  })

  it("writes expected files and splits config into buckets", () => {
    const dir = mkTempDir("speakmcp-modular-write-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)

    const config = {
      textInputEnabled: false,
      mcpMaxIterations: 99,
      openaiApiKey: "sk-test",
      themePreference: "dark",
      mcpCustomSystemPrompt: "",
      mcpToolsSystemPrompt: "Extra guidelines",
    } as unknown as Config

    writeAgentsLayerFromConfig(layer, config, { maxBackups: 3 })
    writeAgentsPrompts(layer, "", "Extra guidelines", DEFAULT_PROMPT, { maxBackups: 3 })

    const systemMd = fs.readFileSync(layer.systemPromptMdPath, "utf8")
    expect(systemMd).toContain("kind: system-prompt")
    expect(systemMd).toContain(DEFAULT_PROMPT)

    const agentsMd = fs.readFileSync(layer.agentsMdPath, "utf8")
    expect(agentsMd).toContain("kind: agents")
    expect(agentsMd).toContain("Extra guidelines")

    const settings = JSON.parse(fs.readFileSync(layer.settingsJsonPath, "utf8"))
    const mcp = JSON.parse(fs.readFileSync(layer.mcpJsonPath, "utf8"))
    const models = JSON.parse(fs.readFileSync(layer.modelsJsonPath, "utf8"))
    const layout = JSON.parse(fs.readFileSync(layer.layoutJsonPath, "utf8"))

    expect(settings.textInputEnabled).toBe(false)
    expect(mcp.mcpMaxIterations).toBe(99)
    expect(models.openaiApiKey).toBe("sk-test")
    expect(layout.themePreference).toBe("dark")
  })

  it("finds .agents directory upward", () => {
    const dir = mkTempDir("speakmcp-find-agents-")
    const rootAgents = path.join(dir, ".agents")
    fs.mkdirSync(rootAgents, { recursive: true })

    const deep = path.join(dir, "a", "b", "c")
    fs.mkdirSync(deep, { recursive: true })

    expect(findAgentsDirUpward(deep)).toBe(rootAgents)
  })
})

