/**
 * Loop Service
 * Manages scheduled agent loops that run at regular intervals
 */

import { configStore } from "./config"
import { logApp } from "./debug"
import { conversationService } from "./conversation-service"
import { agentSessionTracker } from "./agent-session-tracker"
import { profileService } from "./profile-service"
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
  private activeTimers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private loopNextRunAt: Map<string, number> = new Map()

  static getInstance(): LoopService {
    if (!LoopService.instance) {
      LoopService.instance = new LoopService()
    }
    return LoopService.instance
  }

  private constructor() {}

  /**
   * Start all enabled loops from config
   * Called on app startup
   */
  startAllLoops(): void {
    const config = configStore.get()
    const loops = config.loops || []

    logApp(`[LoopService] Starting all loops. Found ${loops.length} configured loops.`)

    for (const loop of loops) {
      if (loop.enabled) {
        this.startLoop(loop.id)
      }
    }
  }

  /**
   * Stop all active loops
   * Called on app shutdown
   */
  stopAllLoops(): void {
    logApp(`[LoopService] Stopping all loops. Active timers: ${this.activeTimers.size}`)

    for (const [loopId] of this.activeTimers) {
      this.stopLoop(loopId)
    }
  }

  /**
   * Start a specific loop by ID
   */
  startLoop(loopId: string): boolean {
    const config = configStore.get()
    const loop = (config.loops || []).find(l => l.id === loopId)

    if (!loop) {
      logApp(`[LoopService] Cannot start loop ${loopId}: not found`)
      return false
    }

    // Stop existing timer if running
    if (this.activeTimers.has(loopId)) {
      this.stopLoop(loopId)
    }

    const intervalMs = loop.intervalMinutes * 60 * 1000

    // Calculate next run time
    this.loopNextRunAt.set(loopId, Date.now() + intervalMs)

    // Create the interval timer
    const timer = setInterval(() => {
      this.executeLoop(loopId)
    }, intervalMs)

    this.activeTimers.set(loopId, timer)

    logApp(`[LoopService] Started loop "${loop.name}" (${loopId}), interval: ${loop.intervalMinutes}m`)

    // If runOnStartup is true, trigger immediately
    if (loop.runOnStartup) {
      logApp(`[LoopService] Loop "${loop.name}" has runOnStartup=true, triggering immediately`)
      // Use setImmediate to avoid blocking startup
      setImmediate(() => this.executeLoop(loopId))
    }

    return true
  }

  /**
   * Stop a specific loop by ID
   */
  stopLoop(loopId: string): boolean {
    const timer = this.activeTimers.get(loopId)

    if (!timer) {
      logApp(`[LoopService] Cannot stop loop ${loopId}: not running`)
      return false
    }

    clearInterval(timer)
    this.activeTimers.delete(loopId)
    this.loopNextRunAt.delete(loopId)

    logApp(`[LoopService] Stopped loop ${loopId}`)
    return true
  }

  /**
   * Manually trigger a loop execution
   */
  async triggerLoop(loopId: string): Promise<boolean> {
    const config = configStore.get()
    const loop = (config.loops || []).find(l => l.id === loopId)

    if (!loop) {
      logApp(`[LoopService] Cannot trigger loop ${loopId}: not found`)
      return false
    }

    logApp(`[LoopService] Manually triggering loop "${loop.name}" (${loopId})`)
    await this.executeLoop(loopId)
    return true
  }

  /**
   * Get status of all loops
   */
  getLoopStatuses(): LoopStatus[] {
    const config = configStore.get()
    const loops = config.loops || []

    return loops.map(loop => ({
      id: loop.id,
      name: loop.name,
      enabled: loop.enabled,
      isRunning: this.activeTimers.has(loop.id),
      lastRunAt: loop.lastRunAt,
      nextRunAt: this.loopNextRunAt.get(loop.id),
      intervalMinutes: loop.intervalMinutes,
    }))
  }

  /**
   * Get status of a specific loop
   */
  getLoopStatus(loopId: string): LoopStatus | undefined {
    const config = configStore.get()
    const loop = (config.loops || []).find(l => l.id === loopId)

    if (!loop) {
      return undefined
    }

    return {
      id: loop.id,
      name: loop.name,
      enabled: loop.enabled,
      isRunning: this.activeTimers.has(loop.id),
      lastRunAt: loop.lastRunAt,
      nextRunAt: this.loopNextRunAt.get(loop.id),
      intervalMinutes: loop.intervalMinutes,
    }
  }

  /**
   * Execute a loop - creates and starts an agent session with the loop's prompt
   */
  private async executeLoop(loopId: string): Promise<void> {
    const config = configStore.get()
    const loops = config.loops || []
    const loop = loops.find(l => l.id === loopId)

    if (!loop) {
      logApp(`[LoopService] Cannot execute loop ${loopId}: not found`)
      return
    }

    logApp(`[LoopService] Executing loop "${loop.name}" (${loopId})`)

    try {
      // Update lastRunAt in config
      const updatedLoops = loops.map(l =>
        l.id === loopId ? { ...l, lastRunAt: Date.now() } : l
      )
      configStore.save({ ...config, loops: updatedLoops })

      // Update next run time if timer is active
      if (this.activeTimers.has(loopId)) {
        const intervalMs = loop.intervalMinutes * 60 * 1000
        this.loopNextRunAt.set(loopId, Date.now() + intervalMs)
      }

      // Build profile snapshot if loop has a specific profile
      let profileSnapshot: SessionProfileSnapshot | undefined
      if (loop.profileId) {
        const profile = profileService.getProfile(loop.profileId)
        if (profile) {
          profileSnapshot = {
            profileId: profile.id,
            profileName: profile.name,
            guidelines: profile.guidelines,
            systemPrompt: profile.systemPrompt,
            mcpServerConfig: profile.mcpServerConfig,
            modelConfig: profile.modelConfig,
            skillsConfig: profile.skillsConfig,
          }
        }
      }

      // Create a new conversation for this loop execution
      const conversationTitle = `[Loop] ${loop.name}`
      const conversation = await conversationService.createConversation(
        loop.prompt,
        "user"
      )

      // Start agent session - snoozed so it runs in background
      const sessionId = agentSessionTracker.startSession(
        conversation.id,
        conversationTitle,
        true, // startSnoozed = true for background execution
        profileSnapshot
      )

      logApp(`[LoopService] Created session ${sessionId} for loop "${loop.name}"`)

      // Import processWithAgentMode dynamically to avoid circular dependency
      // The actual agent processing will be handled by tipc.ts
      const { processLoopAgentSession } = await import("./loop-agent-processor")
      await processLoopAgentSession(loop.prompt, conversation.id, sessionId, profileSnapshot)

    } catch (error) {
      logApp(`[LoopService] Error executing loop "${loop.name}":`, error)
    }
  }
}

export const loopService = LoopService.getInstance()

