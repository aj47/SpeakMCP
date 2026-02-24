/**
 * Repeat Task Service
 * Manages scheduled repeat tasks that run at regular intervals.
 *
 * Tasks are stored as individual `.agents/tasks/<task-id>/task.md` files
 * (global + optional workspace overlay). Legacy `config.json` loops are
 * migrated on first load.
 */

import { configStore, globalAgentsFolder, resolveWorkspaceAgentsFolder } from "./config"
import { logApp } from "./debug"
import { conversationService } from "./conversation-service"
import { agentSessionTracker } from "./agent-session-tracker"
import { agentProfileService, createSessionSnapshotFromProfile } from "./agent-profile-service"
import type { LoopConfig, SessionProfileSnapshot } from "../shared/types"
import { getAgentsLayerPaths } from "./agents-files/modular-config"
import {
  loadTasksLayer,
  writeTaskFile,
  writeAllTaskFiles,
  deleteTaskFiles,
} from "./agents-files/tasks"

export interface LoopStatus {
  id: string
  name: string
  enabled: boolean
  isRunning: boolean
  lastRunAt?: number
  nextRunAt?: number
  intervalMinutes: number
}

class LoopService {
  private static instance: LoopService | null = null
  private activeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private loopNextRunAt: Map<string, number> = new Map()
  private executingLoops: Set<string> = new Set()
  private isStopping: boolean = false
  /** In-memory cache of all tasks (merged from global + workspace layers). */
  private loops: LoopConfig[] = []

  static getInstance(): LoopService {
    if (!LoopService.instance) {
      LoopService.instance = new LoopService()
    }
    return LoopService.instance
  }

  private constructor() {
    this.loadFromDisk()
  }

  // ============================================================================
  // Persistence — load / save / delete
  // ============================================================================

  /** Load tasks from .agents/tasks/ (global + workspace), migrating from config.json if needed. */
  private loadFromDisk(): void {
    const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
    const globalResult = loadTasksLayer(globalLayer)

    const workspaceDir = resolveWorkspaceAgentsFolder()
    let workspaceTasks: LoopConfig[] = []
    if (workspaceDir) {
      const workspaceLayer = getAgentsLayerPaths(workspaceDir)
      workspaceTasks = loadTasksLayer(workspaceLayer).tasks
    }

    if (globalResult.tasks.length > 0 || workspaceTasks.length > 0) {
      // Merge: workspace overrides global by ID
      const mergedById = new Map<string, LoopConfig>()
      for (const t of globalResult.tasks) mergedById.set(t.id, t)
      for (const t of workspaceTasks) mergedById.set(t.id, t) // workspace wins
      this.loops = Array.from(mergedById.values())
      logApp(`[LoopService] Loaded ${this.loops.length} task(s) from .agents/tasks/`)
      return
    }

    // Migration: if config.json has loops but .agents/tasks/ is empty, migrate
    const legacyLoops = configStore.get().loops || []
    if (legacyLoops.length > 0) {
      this.loops = [...legacyLoops]
      try {
        writeAllTaskFiles(globalLayer, legacyLoops, { onlyIfMissing: true, maxBackups: 10 })
        logApp(`[LoopService] Migrated ${legacyLoops.length} task(s) from config.json to .agents/tasks/`)
      } catch (error) {
        logApp("[LoopService] Error migrating tasks to modular files:", error)
      }
      return
    }

    this.loops = []
  }

  /** Persist a single task to the global .agents/tasks/ layer. */
  private saveTask(task: LoopConfig): void {
    try {
      const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
      writeTaskFile(globalLayer, task, { maxBackups: 10 })
    } catch (error) {
      logApp("[LoopService] Error saving task file:", error)
    }
    // Shadow: keep config.json in sync for backward compatibility
    this.syncToConfigJson()
  }

  /** Remove a task's files from the global .agents/tasks/ layer. */
  private removeTaskFiles(taskId: string): void {
    try {
      const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
      deleteTaskFiles(globalLayer, taskId)
    } catch (error) {
      logApp("[LoopService] Error deleting task files:", error)
    }
    this.syncToConfigJson()
  }

  /** Shadow-write all loops back to config.json for backward compatibility. */
  private syncToConfigJson(): void {
    try {
      const config = configStore.get()
      configStore.save({ ...config, loops: this.loops })
    } catch {
      // best-effort
    }
  }

  // ============================================================================
  // Public API — CRUD
  // ============================================================================

  /** Get all loops. */
  getLoops(): LoopConfig[] {
    return this.loops
  }

  /** Get a single loop by ID. */
  getLoop(loopId: string): LoopConfig | undefined {
    return this.loops.find((l) => l.id === loopId)
  }

  /** Save (create or update) a loop. */
  saveLoop(loop: LoopConfig): void {
    const idx = this.loops.findIndex((l) => l.id === loop.id)
    if (idx >= 0) {
      this.loops[idx] = loop
    } else {
      this.loops.push(loop)
    }
    this.saveTask(loop)
  }

  /** Delete a loop. */
  deleteLoop(loopId: string): boolean {
    const idx = this.loops.findIndex((l) => l.id === loopId)
    if (idx === -1) return false
    this.loops.splice(idx, 1)
    this.stopLoop(loopId)
    this.removeTaskFiles(loopId)
    return true
  }

  /** Reload tasks from disk (for external changes). */
  reload(): void {
    this.loadFromDisk()
  }

  // ============================================================================
  // Scheduling
  // ============================================================================

  startAllLoops(): void {
    logApp(`[LoopService] Starting all loops. Found ${this.loops.length} configured loops.`)

    for (const loop of this.loops) {
      if (loop.enabled) {
        this.startLoop(loop.id)
      }
    }
  }

  stopAllLoops(): void {
    this.isStopping = true
    logApp(`[LoopService] Stopping all loops. Active timers: ${this.activeTimers.size}`)
    for (const [loopId] of this.activeTimers) {
      this.stopLoop(loopId)
    }
  }

  resumeScheduling(): void {
    this.isStopping = false
  }

  startLoop(loopId: string): boolean {
    const loop = this.getLoop(loopId)
    if (!loop) {
      logApp(`[LoopService] Cannot start loop ${loopId}: not found`)
      return false
    }

    if (!loop.enabled) {
      logApp(`[LoopService] Not starting loop ${loopId}: disabled`)
      return false
    }

    this.clearScheduledTimer(loopId)

    logApp(`[LoopService] Started loop "${loop.name}" (${loopId}), interval: ${loop.intervalMinutes}m`)

    if (loop.runOnStartup) {
      logApp(`[LoopService] Loop "${loop.name}" has runOnStartup=true, triggering immediately`)
      setImmediate(() => {
        void this.executeLoop(loopId, { rescheduleAfterRun: true })
      })
    } else {
      this.scheduleNextRun(loopId, this.getIntervalMs(loop))
    }

    return true
  }

  stopLoop(loopId: string): boolean {
    const hadTimer = this.activeTimers.has(loopId)
    this.clearScheduledTimer(loopId)

    if (!hadTimer) {
      logApp(`[LoopService] Stop requested for ${loopId}: no scheduled timer`)
      return false
    }

    logApp(`[LoopService] Stopped loop ${loopId}`)
    return true
  }

  async triggerLoop(loopId: string): Promise<boolean> {
    const loop = this.getLoop(loopId)
    if (!loop) {
      logApp(`[LoopService] Cannot trigger loop ${loopId}: not found`)
      return false
    }

    if (this.executingLoops.has(loopId)) {
      logApp(`[LoopService] Skip manual trigger for "${loop.name}" (${loopId}): already executing`)
      return false
    }

    logApp(`[LoopService] Manually triggering loop "${loop.name}" (${loopId})`)
    // Reschedule after manual run if the loop is enabled so we don't lose the timer
    const shouldReschedule = loop.enabled && this.activeTimers.has(loopId)
    await this.executeLoop(loopId, { rescheduleAfterRun: shouldReschedule })
    return true
  }

  getLoopStatuses(): LoopStatus[] {
    return this.loops.map((loop) => ({
      id: loop.id,
      name: loop.name,
      enabled: loop.enabled,
      isRunning: this.executingLoops.has(loop.id),
      lastRunAt: loop.lastRunAt,
      nextRunAt: this.loopNextRunAt.get(loop.id),
      intervalMinutes: loop.intervalMinutes,
    }))
  }

  getLoopStatus(loopId: string): LoopStatus | undefined {
    const loop = this.getLoop(loopId)
    if (!loop) {
      return undefined
    }

    return {
      id: loop.id,
      name: loop.name,
      enabled: loop.enabled,
      isRunning: this.executingLoops.has(loop.id),
      lastRunAt: loop.lastRunAt,
      nextRunAt: this.loopNextRunAt.get(loop.id),
      intervalMinutes: loop.intervalMinutes,
    }
  }

  private async executeLoop(loopId: string, options: { rescheduleAfterRun: boolean }): Promise<void> {
    const loop = this.getLoop(loopId)

    if (!loop) {
      logApp(`[LoopService] Cannot execute loop ${loopId}: not found`)
      return
    }

    if (this.executingLoops.has(loopId)) {
      logApp(`[LoopService] Skip execution for "${loop.name}" (${loopId}): already executing`)
      return
    }

    this.executingLoops.add(loopId)
    this.clearScheduledTimer(loopId)

    logApp(`[LoopService] Executing loop "${loop.name}" (${loopId})`)

    try {
      // Update lastRunAt in memory and persist
      loop.lastRunAt = Date.now()
      this.saveTask(loop)

      let profileSnapshot: SessionProfileSnapshot | undefined
      if (loop.profileId) {
        const profile = agentProfileService.getById(loop.profileId)
        if (profile) {
          profileSnapshot = createSessionSnapshotFromProfile(profile)
        }
      }

      const conversation = await conversationService.createConversation(loop.prompt, "user")
      const conversationTitle = `[Repeat] ${loop.name}`
      const sessionId = agentSessionTracker.startSession(
        conversation.id,
        conversationTitle,
        true,
        profileSnapshot
      )

      logApp(`[LoopService] Created session ${sessionId} for loop "${loop.name}"`)

      // Reuse the main agent execution flow.
      const { runAgentLoopSession } = await import("./tipc")
      await runAgentLoopSession(loop.prompt, conversation.id, sessionId)
    } catch (error) {
      logApp(`[LoopService] Error executing loop "${loop.name}":`, error)
    } finally {
      this.executingLoops.delete(loopId)

      if (options.rescheduleAfterRun && !this.isStopping) {
        const latestLoop = this.getLoop(loopId)
        if (latestLoop?.enabled) {
          this.scheduleNextRun(loopId, this.getIntervalMs(latestLoop))
        }
      }
    }
  }

  private scheduleNextRun(loopId: string, delayMs: number): void {
    this.clearScheduledTimer(loopId)
    this.loopNextRunAt.set(loopId, Date.now() + delayMs)

    const timer = setTimeout(() => {
      this.activeTimers.delete(loopId)
      this.loopNextRunAt.delete(loopId)
      void this.executeLoop(loopId, { rescheduleAfterRun: true })
    }, delayMs)

    this.activeTimers.set(loopId, timer)
  }

  private clearScheduledTimer(loopId: string): void {
    const timer = this.activeTimers.get(loopId)
    if (timer) {
      clearTimeout(timer)
    }
    this.activeTimers.delete(loopId)
    this.loopNextRunAt.delete(loopId)
  }

  private getIntervalMs(loop: LoopConfig): number {
    const safeMinutes = Number.isFinite(loop.intervalMinutes) && loop.intervalMinutes >= 1
      ? Math.floor(loop.intervalMinutes)
      : 1

    if (safeMinutes !== loop.intervalMinutes) {
      logApp(`[LoopService] Loop ${loop.id} has invalid interval (${loop.intervalMinutes}), clamping to ${safeMinutes} minute(s)`)
    }

    return safeMinutes * 60 * 1000
  }
}

export const loopService = LoopService.getInstance()
