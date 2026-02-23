import { describe, it, expect } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import type { AgentSkill } from "@shared/types"
import { getAgentsLayerPaths } from "./modular-config"
import {
  getAgentsSkillsBackupDir,
  getAgentsSkillsDir,
  loadAgentsSkillsLayer,
  parseSkillMarkdown,
  skillIdToFilePath,
  stringifySkillMarkdown,
  writeAgentsSkillFile,
} from "./skills"

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

function setMtimeMs(filePath: string, mtimeMs: number): number {
  fs.utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs))
  return Math.floor(fs.statSync(filePath).mtimeMs)
}

describe("agents-files/skills", () => {
  it("stringifies and parses a skill markdown file (roundtrip)", () => {
    const skill: AgentSkill = {
      id: "skill:1",
      name: "Hello\nWorld",
      description: "Desc\nLine2",
      instructions: "Do X\nDo Y",
      enabled: true,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      source: "local",
    }

    const md = stringifySkillMarkdown(skill)
    expect(md).toContain("kind: skill")
    expect(md).toContain("id: skill:1")
    expect(md).toContain("name: Hello World")
    expect(md).toContain("description: Desc Line2")

    const parsed = parseSkillMarkdown(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe("skill:1")
    expect(parsed!.name).toBe("Hello World")
    expect(parsed!.description).toBe("Desc Line2")
    expect(parsed!.instructions).toBe("Do X\nDo Y")
    expect(parsed!.enabled).toBe(true)
    expect(parsed!.createdAt).toBe(1700000000000)
    expect(parsed!.updatedAt).toBe(1700000001000)
    expect(parsed!.filePath).toBeUndefined()
  })

  it("loads a layer and uses directory path as fallback id", () => {
    const dir = mkTempDir("speakmcp-skills-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)
    const skillsDir = getAgentsSkillsDir(layer)

    const skillFile = path.join(skillsDir, "group", "nested", "skill.md")
    writeFile(
      skillFile,
      `---
kind: skill
name: My Skill
description: D
enabled: true
createdAt: 1
updatedAt: 1
---

Body`,
    )

    const loaded = loadAgentsSkillsLayer(layer)
    expect(loaded.skills.map((s) => s.id)).toEqual(["group/nested"])
    expect(loaded.originById.get("group/nested")?.filePath).toBe(skillFile)
    expect(loaded.skills[0].filePath).toBe(skillFile)
  })

  it("keeps the newest duplicate by updatedAt", () => {
    const dir = mkTempDir("speakmcp-skills-dupes-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)
    const skillsDir = getAgentsSkillsDir(layer)

    const a = path.join(skillsDir, "a", "skill.md")
    const b = path.join(skillsDir, "b", "skill.md")

    writeFile(
      a,
      `---
kind: skill
id: dup
name: Old
description: X
enabled: true
createdAt: 1
updatedAt: 100
---

Body`,
    )

    writeFile(
      b,
      `---
kind: skill
id: dup
name: New
description: X
enabled: true
createdAt: 1
updatedAt: 200
---

Body`,
    )

    const loaded = loadAgentsSkillsLayer(layer)
    const s = loaded.skills.find((x) => x.id === "dup")
    expect(s?.updatedAt).toBe(200)
    expect(loaded.originById.get("dup")?.filePath).toBe(b)
  })

  it("defaults missing timestamps to file mtime (stable)", () => {
    const dir = mkTempDir("speakmcp-skills-mtime-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)
    const skillsDir = getAgentsSkillsDir(layer)

    const filePath = path.join(skillsDir, "mtime", "skill.md")
    writeFile(
      filePath,
      `---
kind: skill
id: mtime-test
name: M
description: D
enabled: true
---

Body`,
    )

    const actualMtime = setMtimeMs(filePath, 1700000005000)
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = parseSkillMarkdown(raw, { filePath })

    expect(parsed).not.toBeNull()
    expect(parsed!.createdAt).toBe(actualMtime)
    expect(parsed!.updatedAt).toBe(actualMtime)
  })

  it("parses and stringifies filePath override relative to the skill file", () => {
    const dir = mkTempDir("speakmcp-skills-filepath-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)
    const skillsDir = getAgentsSkillsDir(layer)

    const skillFile = path.join(skillsDir, "with-override", "skill.md")
    const repoSkill = path.join(path.dirname(skillFile), ".repo", "SKILL.md")
    writeFile(repoSkill, "---\nname: Repo Skill\n---\n\nBody")

    writeFile(
      skillFile,
      `---
kind: skill
id: with-override
name: Wrapper
description: D
enabled: true
createdAt: 1
updatedAt: 2
filePath: .repo/SKILL.md
---

Body`,
    )

    const loaded = loadAgentsSkillsLayer(layer)
    const s = loaded.skills.find((x) => x.id === "with-override")
    expect(s).toBeTruthy()
    expect(loaded.originById.get("with-override")?.filePath).toBe(skillFile)
    expect(s!.filePath).toBe(repoSkill)

    const md = stringifySkillMarkdown(s!, { originFilePath: skillFile })
    expect(md).toContain("filePath: .repo/SKILL.md")
  })

  it("writes skill files with backups on overwrite", () => {
    const dir = mkTempDir("speakmcp-skills-write-")
    const agentsDir = path.join(dir, ".agents")
    const layer = getAgentsLayerPaths(agentsDir)

    const base: AgentSkill = {
      id: "weird:id/1",
      name: "V1",
      description: "D",
      instructions: "Body",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    }

    writeAgentsSkillFile(layer, base, { maxBackups: 5 })
    const filePath = skillIdToFilePath(layer, base.id)
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, "utf8")).toContain("name: V1")

    writeAgentsSkillFile(layer, { ...base, updatedAt: 2, name: "V2" }, { maxBackups: 5 })
    expect(fs.readFileSync(filePath, "utf8")).toContain("name: V2")

    const backupDir = getAgentsSkillsBackupDir(layer)
    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.endsWith(".bak")) : []
    expect(backups.length).toBe(1)
    expect(fs.readFileSync(path.join(backupDir, backups[0]), "utf8")).toContain("name: V1")
  })
})
