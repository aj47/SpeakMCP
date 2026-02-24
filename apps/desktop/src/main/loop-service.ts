/**
 * Repeat Task Service
 * Manages scheduled repeat tasks that run at regular intervals.
 */

import { configStore } from "./config"
import { logApp } from "./debug"
import { conversationService } from "./conversation-service"
import { agentSessionTracker } from "./agent-session-tracker"
import { agentProfileService, createSessionSnapshotFromProfile } from "./agent-profile-service"
import type { LoopConfig, SessionProfileSnapshot } from "../shared/types"

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

  static getInstance(): LoopService {
    if (!LoopService.instance) {
      LoopService.instance = new LoopService()
    }
    return LoopService.instance
  }

  private constructor() {}

  startAllLoops(): void {
    const loops = configStore.get().loops || []
    logApp(`[LoopService] Starting all loops. Found ${loops.length} configured loops.`)

    for (const loop of loops) {
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
    const loop = (configStore.get().loops || []).find((l) => l.id === loopId)
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
    const loop = (configStore.get().loops || []).find((l) => l.id === loopId)
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
    const loops = configStore.get().loops || []

    return loops.map((loop) => ({
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
    const loop = (configStore.get().loops || []).find((l) => l.id === loopId)
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
    const config = configStore.get()
    const loops = config.loops || []
    const loop = loops.find((l) => l.id === loopId)

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
      // Re-fetch latest config to avoid race conditions with other config updates
      const latestConfig = configStore.get()
      const latestLoops = latestConfig.loops || []
      const updatedLoops = latestLoops.map((l) =>
        l.id === loopId ? { ...l, lastRunAt: Date.now() } : l
      )
      configStore.save({ ...latestConfig, loops: updatedLoops })

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
        const latestLoop = (configStore.get().loops || []).find((l) => l.id === loopId)
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
