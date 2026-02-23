import { describe, it, expect } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { safeReadJsonFileSync, safeWriteFileSync, safeWriteJsonFileSync } from "./safe-file"

describe("safe-file", () => {
  it("writes atomically and creates backups on overwrite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speakmcp-safe-file-"))
    const filePath = path.join(dir, "settings.json")
    const backupDir = path.join(dir, "backups")

    safeWriteFileSync(filePath, "one", { backupDir, maxBackups: 5 })
    expect(fs.readFileSync(filePath, "utf8")).toBe("one")

    safeWriteFileSync(filePath, "two", { backupDir, maxBackups: 5 })
    expect(fs.readFileSync(filePath, "utf8")).toBe("two")

    const backups = fs.readdirSync(backupDir).filter((f) => f.endsWith(".bak"))
    expect(backups.length).toBe(1)
    expect(fs.readFileSync(path.join(backupDir, backups[0]), "utf8")).toBe("one")
  })

  it("rotates backups", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speakmcp-safe-file-"))
    const filePath = path.join(dir, "settings.json")
    const backupDir = path.join(dir, "backups")

    safeWriteFileSync(filePath, "v1", { backupDir, maxBackups: 1 })
    safeWriteFileSync(filePath, "v2", { backupDir, maxBackups: 1 })
    safeWriteFileSync(filePath, "v3", { backupDir, maxBackups: 1 })

    const backups = fs.readdirSync(backupDir).filter((f) => f.endsWith(".bak"))
    expect(backups.length).toBe(1)
  })

  it("recovers corrupted JSON from latest backup", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speakmcp-safe-file-"))
    const filePath = path.join(dir, "data.json")
    const backupDir = path.join(dir, "backups")

    safeWriteJsonFileSync(filePath, { a: 1 }, { backupDir, maxBackups: 5 })
    safeWriteJsonFileSync(filePath, { a: 2 }, { backupDir, maxBackups: 5 })
    fs.writeFileSync(filePath, "{not json", "utf8")

    const recovered = safeReadJsonFileSync<{ a: number }>(filePath, { backupDir, defaultValue: { a: 0 } })
    expect(recovered).toEqual({ a: 1 })

    // File should be restored to valid JSON too
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ a: 1 })
  })
})
