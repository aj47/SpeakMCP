/**
 * ActiveConversationSync - Fast polling sync for the currently viewed conversation.
 *
 * Problem: The existing sync mechanism (App.tsx) polls every 15s for the full
 * conversation list, which is too slow and heavyweight for real-time message
 * updates. Messages get lost, cut off, or arrive late.
 *
 * Solution: This service polls every 3 seconds ONLY for the currently viewed
 * conversation using a lightweight status endpoint (updatedAt + messageCount).
 * Only when the server state has changed does it fetch the full conversation.
 *
 * Flow:
 *   1. Every 3s, call GET /conversations/:id/status → { updatedAt, messageCount }
 *   2. Compare with locally known updatedAt / messageCount
 *   3. If different → fetch full conversation via GET /conversations/:id
 *   4. Deliver the updated messages to the caller via callback
 */

import { SettingsApiClient, ConversationStatus, ServerConversationMessage } from './settingsApi';

const POLL_INTERVAL_MS = 3000;

export interface ActiveSyncState {
  /** Whether the sync loop is currently running */
  isActive: boolean;
  /** Timestamp of the last successful sync check */
  lastCheckAt: number | null;
  /** Timestamp of the last time messages were actually updated */
  lastUpdateAt: number | null;
  /** Number of consecutive errors */
  errorCount: number;
  /** Last error message, if any */
  lastError: string | null;
}

export interface ConversationUpdate {
  conversationId: string;
  messages: ServerConversationMessage[];
  title: string;
  updatedAt: number;
  messageCount: number;
}

export type OnConversationUpdate = (update: ConversationUpdate) => void;
export type OnSyncStateChange = (state: ActiveSyncState) => void;

export class ActiveConversationSync {
  private client: SettingsApiClient;
  private conversationId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  // Known server state to detect changes
  private knownUpdatedAt: number = 0;
  private knownMessageCount: number = 0;

  // Callbacks
  private onUpdate: OnConversationUpdate | null = null;
  private onStateChange: OnSyncStateChange | null = null;

  // State
  private state: ActiveSyncState = {
    isActive: false,
    lastCheckAt: null,
    lastUpdateAt: null,
    errorCount: 0,
    lastError: null,
  };

  constructor(client: SettingsApiClient) {
    this.client = client;
  }

  /**
   * Update the API client (e.g., when credentials change).
   */
  updateClient(client: SettingsApiClient): void {
    this.client = client;
  }

  /**
   * Start polling for a specific conversation.
   * Stops any existing polling first.
   *
   * @param conversationId - The server-side conversation ID to poll
   * @param initialUpdatedAt - The locally known updatedAt (to avoid unnecessary first fetch)
   * @param initialMessageCount - The locally known message count
   * @param onUpdate - Called when new messages are available
   * @param onStateChange - Called when sync state changes (for UI indicators)
   */
  start(
    conversationId: string,
    initialUpdatedAt: number,
    initialMessageCount: number,
    onUpdate: OnConversationUpdate,
    onStateChange?: OnSyncStateChange,
  ): void {
    // Stop any existing polling
    this.stop();

    this.conversationId = conversationId;
    this.knownUpdatedAt = initialUpdatedAt;
    this.knownMessageCount = initialMessageCount;
    this.onUpdate = onUpdate;
    this.onStateChange = onStateChange || null;

    this.updateState({
      isActive: true,
      lastCheckAt: null,
      lastUpdateAt: null,
      errorCount: 0,
      lastError: null,
    });

    // Do an immediate check, then start the interval
    void this.pollOnce();

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;

    // Emit the inactive state BEFORE clearing callbacks so callers
    // observe the transition and can update UI (e.g., hide sync indicator)
    if (this.state.isActive) {
      this.updateState({
        ...this.state,
        isActive: false,
      });
    }

    this.conversationId = null;
    this.onUpdate = null;
    this.onStateChange = null;
  }

  /**
   * Force an immediate sync (e.g., user taps a refresh button).
   * Resets error count. Uses isPolling lock to avoid concurrent fetches.
   */
  async forceSync(): Promise<void> {
    if (!this.conversationId) return;
    // Use the same isPolling lock to avoid concurrent fetches
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      this.updateState({ ...this.state, errorCount: 0, lastError: null });
      await this.fetchAndDeliver();
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Update the known state (e.g., after a local message send).
   * This prevents the next poll from re-fetching data we already have.
   */
  updateKnownState(updatedAt: number, messageCount: number): void {
    this.knownUpdatedAt = updatedAt;
    this.knownMessageCount = messageCount;
  }

  /**
   * Get the current known server state (for callers that need to
   * update only part of the known state without introducing clock skew).
   */
  getKnownState(): { updatedAt: number; messageCount: number } {
    return { updatedAt: this.knownUpdatedAt, messageCount: this.knownMessageCount };
  }

  /**
   * Get current sync state.
   */
  getState(): ActiveSyncState {
    return { ...this.state };
  }

  /**
   * Check if currently active.
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  // -- Private --

  private async pollOnce(): Promise<void> {
    if (this.isPolling || !this.conversationId) return;
    this.isPolling = true;

    try {
      const status = await this.client.getConversationStatus(this.conversationId);

      // Only update lastCheckAt here — don't reset errorCount yet.
      // A successful status check followed by a failed full fetch should
      // still count errors. errorCount is reset in fetchAndDeliver on success.
      this.updateState({
        ...this.state,
        lastCheckAt: Date.now(),
      });

      // Check if server state differs from what we know
      const hasChanged =
        status.updatedAt > this.knownUpdatedAt ||
        status.messageCount !== this.knownMessageCount;

      if (hasChanged) {
        await this.fetchAndDeliver();
      } else {
        // No change detected and no fetch needed — status check was fully successful
        this.updateState({
          ...this.state,
          errorCount: 0,
          lastError: null,
        });
      }
    } catch (err: any) {
      const errorCount = this.state.errorCount + 1;
      this.updateState({
        ...this.state,
        lastCheckAt: Date.now(),
        errorCount,
        lastError: err.message || 'Unknown error',
      });

      // After 5 consecutive errors, stop polling to avoid hammering a dead server
      if (errorCount >= 5) {
        console.warn('[ActiveConversationSync] Too many errors, stopping polling');
        this.stop();
      }
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchAndDeliver(): Promise<void> {
    // Snapshot conversation ID and callback before the async operation
    // so we can discard stale results if the user switches conversations mid-fetch
    const targetConversationId = this.conversationId;
    const targetOnUpdate = this.onUpdate;

    if (!targetConversationId || !targetOnUpdate) return;

    try {
      const fullConv = await this.client.getConversation(targetConversationId);

      // Discard if the active conversation changed while we were fetching
      if (this.conversationId !== targetConversationId) {
        console.log('[ActiveConversationSync] Discarding stale fetch result for', targetConversationId);
        return;
      }

      // Update known state
      this.knownUpdatedAt = fullConv.updatedAt;
      this.knownMessageCount = fullConv.messages.length;

      this.updateState({
        ...this.state,
        lastUpdateAt: Date.now(),
        errorCount: 0,
        lastError: null,
      });

      // Deliver to caller (re-check in case stop() was called during await)
      if (this.onUpdate) {
        this.onUpdate({
          conversationId: fullConv.id,
          messages: fullConv.messages,
          title: fullConv.title,
          updatedAt: fullConv.updatedAt,
          messageCount: fullConv.messages.length,
        });
      }
    } catch (err: any) {
      const errorCount = this.state.errorCount + 1;
      this.updateState({
        ...this.state,
        errorCount,
        lastError: `Fetch failed: ${err.message || 'Unknown error'}`,
      });
      console.error('[ActiveConversationSync] Failed to fetch full conversation:', err.message);

      // Full-fetch errors also count toward the 5-error stop threshold
      if (errorCount >= 5) {
        console.warn('[ActiveConversationSync] Too many fetch errors, stopping polling');
        this.stop();
      }
    }
  }

  private updateState(newState: ActiveSyncState): void {
    this.state = newState;
    this.onStateChange?.(newState);
  }
}
