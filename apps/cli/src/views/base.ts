/**
 * Base View class for all TUI views
 */

import type { CliRenderer, BoxRenderable } from '@opentui/core'
import type { SpeakMcpClient } from '../client'
import type { AppState } from '../types'

export abstract class BaseView {
  protected renderer: CliRenderer
  protected client: SpeakMcpClient
  protected state: AppState
  protected container: BoxRenderable
  protected isVisible: boolean = false
  protected viewContainer: BoxRenderable | null = null

  constructor(
    renderer: CliRenderer,
    client: SpeakMcpClient,
    state: AppState,
    container: BoxRenderable
  ) {
    this.renderer = renderer
    this.client = client
    this.state = state
    this.container = container
  }

  abstract show(): Promise<void>

  hide(): void {
    if (this.viewContainer) {
      this.container.remove(this.viewContainer.id)
      this.viewContainer = null
    }
    this.isVisible = false
  }

  protected abstract createContent(): Promise<BoxRenderable>

  protected async refresh(): Promise<void> {
    if (!this.isVisible) return
    this.hide()
    await this.show()
  }
}

