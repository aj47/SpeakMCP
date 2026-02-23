import { describe, it, expect } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import type { AgentMemory } from "@shared/types"
import { getAgentsLayerPaths } from "./modular-config"
import {
  getAgentsMemoriesBackupDir,
  getAgentsMemoriesDir,
  loadAgentsMemoriesLayer,
  memoryIdToFilePath,
  parseMemoryMarkdown,
  stringifyMemoryMarkdown,
  writeAgentsMemoryFile,
} from "./memories"

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

describe("agents-files/memories", () => {
  it("stringifies and parses a memory markdown file (roundtrip)", () => {
    const memory: AgentMemory = {
      id: "mem:1",
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      title: "Hello\nWorld",
      content: "Line1\nLine2",
      tags: ["foo", "bar"],
      keyFindings: ["finding 1", "finding 2"],
      importance: "high",
      profileId: "profile1",
      sessionId: "sess1",
      conversationId: "conv1",
      conversationTitle: "Conv\nTitle",
      userNotes: "Notes line 1\n\nNotes line 2\n",
    }

    const md = stringifyMemoryMarkdown(memory)
    expect(md).toContain("kind: memory")
    expect(md).toContain("id: mem:1")

    const parsed = parseMemoryMarkdown(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe("mem:1")
    expect(parsed!.title).toBe("Hello World")
    expect(parsed!.content).toBe("Line1 Line2")
    expect(parsed!.tags).toEqual(["foo", "bar"])
    expect(parsed!.keyFindings).toEqual(["finding 1", "finding 2"])
    expect(parsed!.conversationTitle).toBe("Conv Title")
    expect(parsed!.userNotes).toBe("Notes line 1\n\nNotes line 2")
  })

  it("parses list values from JSON array strings (robustness)", () => {
    const md = `---
kind: memory
id: m1
createdAt: 1
updatedAt: 2
title: T
content: C
importance: medium
tags: ["a", "b"]
keyFindings: ["x", "y"]
---

Body`

    const parsed = parseMemoryMarkdown(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.tags).toEqual(["a", "b"])
    expect(parsed!.keyFindings).toEqual(["x", "y"])
  })

  it("loads a layer and uses filename as fallback id", () => {
    const dir = mkTempDir("speakmcp-memories-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)
    const memoriesDir = getAgentsMemoriesDir(layer)

    writeFile(
      path.join(memoriesDir, "no-id.md"),
      `---
kind: memory
createdAt: 1
updatedAt: 1
title: Hello
content: Something
importance: low
---

notes`,
    )

    const loaded = loadAgentsMemoriesLayer(layer)
    expect(loaded.memories.map((m) => m.id)).toEqual(["no-id"])
    expect(loaded.originById.get("no-id")?.filePath).toBe(path.join(memoriesDir, "no-id.md"))
  })

  it("keeps the newest duplicate by updatedAt", () => {
    const dir = mkTempDir("speakmcp-memories-dupes-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)
    const memoriesDir = getAgentsMemoriesDir(layer)

    writeFile(
      path.join(memoriesDir, "a.md"),
      `---
kind: memory
id: dup
createdAt: 1
updatedAt: 100
title: Old
content: X
importance: medium
---`,
    )

    writeFile(
      path.join(memoriesDir, "b.md"),
      `---
kind: memory
id: dup
createdAt: 1
updatedAt: 200
title: New
content: X
importance: medium
---`,
    )

    const loaded = loadAgentsMemoriesLayer(layer)
    const mem = loaded.memories.find((m) => m.id === "dup")
    expect(mem?.updatedAt).toBe(200)
    expect(loaded.originById.get("dup")?.filePath).toBe(path.join(memoriesDir, "b.md"))
  })

  it("writes memory files with backups on overwrite", () => {
    const dir = mkTempDir("speakmcp-memories-write-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)

    const base: AgentMemory = {
      id: "weird:id/1",
      createdAt: 1,
      updatedAt: 1,
      title: "V1",
      content: "C",
      tags: [],
      keyFindings: [],
      importance: "medium",
    }

    writeAgentsMemoryFile(layer, base, { maxBackups: 5 })
    const filePath = memoryIdToFilePath(layer, base.id)
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, "utf8")).toContain("title: V1")

    writeAgentsMemoryFile(layer, { ...base, updatedAt: 2, title: "V2" }, { maxBackups: 5 })
    expect(fs.readFileSync(filePath, "utf8")).toContain("title: V2")

    const backupDir = getAgentsMemoriesBackupDir(layer)
    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.endsWith(".bak")) : []
    expect(backups.length).toBe(1)
    expect(fs.readFileSync(path.join(backupDir, backups[0]), "utf8")).toContain("title: V1")
  })
})
