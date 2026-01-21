/**
 * Main TUI Application using OpenTUI
 */

import {
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
  Renderable,
  BoxRenderable,
  TextRenderable,
  TabSelectRenderable,
  TabSelectRenderableEvents,
} from '@opentui/core'

import { SpeakMcpClient } from './client'
import type { CliConfig, ViewName, AppState } from './types'
import { ChatView } from './views/chat'
import { SessionsView } from './views/sessions'
import { SettingsView } from './views/settings'
import { ToolsView } from './views/tools'

const TAB_OPTIONS = [
  { name: 'Chat', description: 'Send messages and chat with the agent' },
  { name: 'Sessions', description: 'Browse conversation history' },
  { name: 'Settings', description: 'View and modify configuration' },
  { name: 'Tools', description: 'Browse available MCP tools' },
]

export class App {
  private client: SpeakMcpClient
  private config: CliConfig
  private renderer!: CliRenderer
  private state: AppState = {
    currentView: 'chat',
    isConnected: true,
    isProcessing: false,
  }

  // Views
  private chatView!: ChatView
  private sessionsView!: SessionsView
  private settingsView!: SettingsView
  private toolsView!: ToolsView

  // UI Components
  private tabSelect!: TabSelectRenderable
  private contentContainer!: BoxRenderable
  private statusBar!: TextRenderable

  constructor(client: SpeakMcpClient, config: CliConfig) {
    this.client = client
    this.config = config
    if (config.conversationId) {
      this.state.currentConversationId = config.conversationId
    }
  }

  async run(): Promise<void> {
    // Create the renderer
    this.renderer = await createCliRenderer({
      targetFps: 30,
    })

    // Setup keyboard handlers
    this.setupKeyboardHandlers()

    // Create the main layout
    await this.createLayout()

    // Load initial data
    await this.loadInitialData()

    // Start the renderer
    this.renderer.start()
  }

  private setupKeyboardHandlers(): void {
    this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
      // Global keybindings
      if (key.ctrl && key.name === 'c') {
        if (this.state.isProcessing) {
          this.handleEmergencyStop()
        } else {
          this.shutdown()
        }
        return
      }

      // F-keys for view switching
      if (key.name === 'f1') {
        this.switchView('chat')
        return
      }
      if (key.name === 'f2') {
        this.switchView('sessions')
        return
      }
      if (key.name === 'f3') {
        this.switchView('settings')
        return
      }
      if (key.name === 'f4') {
        this.switchView('tools')
        return
      }
    })
  }

  private async createLayout(): Promise<void> {
    const root = this.renderer.root

    // Main container - vertical flex (using BoxRenderable as container)
    const mainContainer = new BoxRenderable(this.renderer, {
      id: 'main-container',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })
    root.add(mainContainer)

    // Tab bar at top
    this.tabSelect = new TabSelectRenderable(this.renderer, {
      id: 'tab-bar',
      width: '100%',
      height: 3,
      options: TAB_OPTIONS,
      tabWidth: 15,
    })
    this.tabSelect.on(TabSelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      const views: ViewName[] = ['chat', 'sessions', 'settings', 'tools']
      this.switchView(views[index])
    })
    mainContainer.add(this.tabSelect)

    // Content area - grows to fill available space
    this.contentContainer = new BoxRenderable(this.renderer, {
      id: 'content-container',
      flexGrow: 1,
      width: '100%',
      overflow: 'hidden',
    })
    mainContainer.add(this.contentContainer)

    // Status bar at bottom
    const statusContainer = new BoxRenderable(this.renderer, {
      id: 'status-container',
      width: '100%',
      height: 1,
      backgroundColor: '#333333',
    })
    this.statusBar = new TextRenderable(this.renderer, {
      id: 'status-text',
      content: this.getStatusText(),
      fg: '#AAAAAA',
    })
    statusContainer.add(this.statusBar)
    mainContainer.add(statusContainer)

    // Initialize views
    this.chatView = new ChatView(this.renderer, this.client, this.state, this.contentContainer)
    this.sessionsView = new SessionsView(this.renderer, this.client, this.state, this.contentContainer)
    this.settingsView = new SettingsView(this.renderer, this.client, this.state, this.contentContainer)
    this.toolsView = new ToolsView(this.renderer, this.client, this.state, this.contentContainer)

    // Show initial view
    await this.chatView.show()
  }

  private getStatusText(): string {
    const profile = this.state.currentProfile?.name || 'default'
    const connected = this.state.isConnected ? '●' : '○'
    const processing = this.state.isProcessing ? ' [Processing...]' : ''
    return ` Profile: ${profile} │ Server: ${connected}${processing}`
  }

  private updateStatusBar(): void {
    this.statusBar.content = this.getStatusText()
  }

  private async loadInitialData(): Promise<void> {
    try {
      // Load current profile
      const profile = await this.client.getCurrentProfile()
      this.state.currentProfile = profile
      this.updateStatusBar()
    } catch {
      // Ignore errors loading initial data
    }
  }

  private async switchView(view: ViewName): Promise<void> {
    if (this.state.currentView === view) return

    // Hide current view
    switch (this.state.currentView) {
      case 'chat':
        this.chatView.hide()
        break
      case 'sessions':
        this.sessionsView.hide()
        break
      case 'settings':
        this.settingsView.hide()
        break
      case 'tools':
        this.toolsView.hide()
        break
    }

    // Update state and tab selection
    this.state.currentView = view
    const viewIndex = ['chat', 'sessions', 'settings', 'tools'].indexOf(view)
    this.tabSelect.setSelectedIndex(viewIndex)

    // Show new view
    switch (view) {
      case 'chat':
        await this.chatView.show()
        break
      case 'sessions':
        await this.sessionsView.show()
        break
      case 'settings':
        await this.settingsView.show()
        break
      case 'tools':
        await this.toolsView.show()
        break
    }
  }

  private async handleEmergencyStop(): Promise<void> {
    try {
      await this.client.emergencyStop()
      this.state.isProcessing = false
      this.updateStatusBar()
    } catch {
      // Ignore errors
    }
  }

  private shutdown(): void {
    this.renderer.stop()
    process.exit(0)
  }

  // Public methods for views to update state
  setProcessing(isProcessing: boolean): void {
    this.state.isProcessing = isProcessing
    this.updateStatusBar()
  }

  setConversationId(id: string): void {
    this.state.currentConversationId = id
  }

  async switchToChat(conversationId?: string): Promise<void> {
    if (conversationId) {
      this.state.currentConversationId = conversationId
    }
    await this.switchView('chat')
  }
}

