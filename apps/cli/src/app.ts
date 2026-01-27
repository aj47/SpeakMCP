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
  SelectRenderable,
  SelectRenderableEvents,
} from '@opentui/core'

import { SpeakMcpClient } from './client'
import type { CliConfig, ViewName, AppState, ConnectionState, Profile } from './types'
import { ChatView } from './views/chat'
import { SessionsView } from './views/sessions'
import { SettingsView } from './views/settings'
import { ToolsView } from './views/tools'

const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds when idle

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
    connectionState: 'online',
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

  // Overlay state
  private helpOverlay: BoxRenderable | null = null
  private profileSwitcher: BoxRenderable | null = null
  private profiles: Profile[] = []

  // Health check timer
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null

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

    // Start periodic health check
    this.startHealthCheck()

    // Start the renderer
    this.renderer.start()
  }

  private setupKeyboardHandlers(): void {
    this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
      // Handle overlays first - they capture all input
      if (this.helpOverlay) {
        this.hideHelpOverlay()
        return
      }
      if (this.profileSwitcher) {
        if (key.name === 'escape') {
          this.hideProfileSwitcher()
        }
        // Let the profile switcher handle its own input
        return
      }

      // Global keybindings
      if (key.ctrl && key.name === 'c') {
        if (this.state.isProcessing) {
          this.handleEmergencyStop()
        } else {
          this.shutdown()
        }
        return
      }

      // Ctrl+N - New conversation
      if (key.ctrl && key.name === 'n') {
        this.handleNewConversation()
        return
      }

      // Ctrl+P - Profile switcher
      if (key.ctrl && key.name === 'p') {
        this.showProfileSwitcher()
        return
      }

      // ? or F12 - Help overlay
      if (key.name === '?' || key.sequence === '?' || key.name === 'f12') {
        this.showHelpOverlay()
        return
      }

      // Escape - Cancel / Go back
      if (key.name === 'escape') {
        this.handleEscape()
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

      // Pass key events to current view
      this.handleViewKeyPress(key)
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

    // Wire up sessions view callback
    this.sessionsView.setSwitchToChatCallback((conversationId?: string) => this.switchToChat(conversationId))

    // Show initial view
    await this.chatView.show()
  }

  private getStatusText(): string {
    const profile = this.state.currentProfile?.name || 'default'
    const connectionIndicator = this.getConnectionIndicator()
    const processing = this.state.isProcessing ? ' [Processing...]' : ''
    return ` Profile: ${profile} │ ${connectionIndicator}${processing}`
  }

  private getConnectionIndicator(): string {
    switch (this.state.connectionState) {
      case 'online':
        return '● Online'
      case 'reconnecting':
        return '○ Reconnecting...'
      case 'offline':
        return '✗ Offline'
    }
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
    this.stopHealthCheck()
    this.renderer.stop()
    process.exit(0)
  }

  // Health check - runs periodically when idle
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      // Only check when not processing
      if (!this.state.isProcessing) {
        this.checkHealth()
      }
    }, HEALTH_CHECK_INTERVAL)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private async checkHealth(): Promise<void> {
    const newState = await this.client.checkHealthWithState(() => {
      // Called when transitioning to reconnecting
      this.setConnectionState('reconnecting')
    })
    this.setConnectionState(newState)
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.state.connectionState !== state) {
      this.state.connectionState = state
      this.updateStatusBar()
    }
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

  // Handle new conversation shortcut
  private async handleNewConversation(): Promise<void> {
    await this.chatView.newConversation()
    await this.switchView('chat')
  }

  // Handle Escape key
  private handleEscape(): void {
    // If in settings, reset changes
    if (this.state.currentView === 'settings') {
      this.settingsView.handleKeyPress('escape')
    }
    // Otherwise, could go back or cancel current action
  }

  // Pass key events to current view
  private handleViewKeyPress(key: KeyEvent): void {
    switch (this.state.currentView) {
      case 'chat':
        this.chatView.handleKeyPress(key)
        break
      case 'sessions':
        this.sessionsView.handleKeyPress(key)
        break
      case 'settings':
        this.settingsView.handleKeyPress(key.name || '')
        break
      case 'tools':
        // Tools view doesn't need custom key handling yet
        break
    }
  }

  // Help overlay
  private showHelpOverlay(): void {
    if (this.helpOverlay) return

    const root = this.renderer.root

    // Create overlay background
    this.helpOverlay = new BoxRenderable(this.renderer, {
      id: 'help-overlay',
      width: '100%',
      height: '100%',
      backgroundColor: '#000000CC',
      justifyContent: 'center',
      alignItems: 'center',
    })

    // Create help box
    const helpBox = new BoxRenderable(this.renderer, {
      id: 'help-box',
      width: 52,
      height: 24,
      borderStyle: 'single',
      borderColor: '#888888',
      backgroundColor: '#1a1a1a',
      padding: 1,
      flexDirection: 'column',
    })

    // Title
    const title = new TextRenderable(this.renderer, {
      id: 'help-title',
      content: '─ Keyboard Shortcuts ─',
      fg: '#FFFFFF',
    })
    helpBox.add(title)

    // Global shortcuts
    const globalHeader = new TextRenderable(this.renderer, {
      id: 'help-global-header',
      content: '\n Global',
      fg: '#88AAFF',
    })
    helpBox.add(globalHeader)

    const globalShortcuts = [
      '   F1-F4      Switch views',
      '   Ctrl+N     New conversation',
      '   Ctrl+P     Switch profile',
      '   Ctrl+C     Stop agent / Quit',
      '   Esc        Cancel / Close',
      '   ? / F12    This help',
    ]
    for (const s of globalShortcuts) {
      helpBox.add(new TextRenderable(this.renderer, {
        id: `help-${Math.random()}`,
        content: s,
        fg: '#CCCCCC',
      }))
    }

    // Chat shortcuts
    const chatHeader = new TextRenderable(this.renderer, {
      id: 'help-chat-header',
      content: '\n Chat',
      fg: '#88AAFF',
    })
    helpBox.add(chatHeader)

    const chatShortcuts = [
      '   Enter      Send message',
      '   Up/Down    Scroll history',
      '   PgUp/PgDn  Scroll page',
    ]
    for (const s of chatShortcuts) {
      helpBox.add(new TextRenderable(this.renderer, {
        id: `help-${Math.random()}`,
        content: s,
        fg: '#CCCCCC',
      }))
    }

    // Sessions shortcuts
    const sessionsHeader = new TextRenderable(this.renderer, {
      id: 'help-sessions-header',
      content: '\n Sessions',
      fg: '#88AAFF',
    })
    helpBox.add(sessionsHeader)

    const sessionsShortcuts = [
      '   Enter      Resume conversation',
      '   N          New conversation',
      '   D          Delete selected',
      '   /          Search',
    ]
    for (const s of sessionsShortcuts) {
      helpBox.add(new TextRenderable(this.renderer, {
        id: `help-${Math.random()}`,
        content: s,
        fg: '#CCCCCC',
      }))
    }

    // Footer
    const footer = new TextRenderable(this.renderer, {
      id: 'help-footer',
      content: '\n                      [Press any key]',
      fg: '#888888',
    })
    helpBox.add(footer)

    this.helpOverlay.add(helpBox)
    root.add(this.helpOverlay)
  }

  private hideHelpOverlay(): void {
    if (!this.helpOverlay) return
    this.renderer.root.remove(this.helpOverlay.id)
    this.helpOverlay = null
  }

  // Profile switcher popup
  private async showProfileSwitcher(): Promise<void> {
    if (this.profileSwitcher) return

    // Load profiles
    let currentProfileId: string | undefined
    try {
      const result = await this.client.getProfiles()
      this.profiles = result.profiles || []
      currentProfileId = result.currentProfileId
    } catch {
      this.profiles = []
    }

    if (this.profiles.length === 0) return

    const root = this.renderer.root

    // Create overlay
    this.profileSwitcher = new BoxRenderable(this.renderer, {
      id: 'profile-overlay',
      width: '100%',
      height: '100%',
      backgroundColor: '#000000CC',
      justifyContent: 'center',
      alignItems: 'center',
    })

    // Create profile box
    const profileBox = new BoxRenderable(this.renderer, {
      id: 'profile-box',
      width: 40,
      height: Math.min(this.profiles.length + 4, 15),
      borderStyle: 'single',
      borderColor: '#888888',
      backgroundColor: '#1a1a1a',
      padding: 1,
      flexDirection: 'column',
    })

    const title = new TextRenderable(this.renderer, {
      id: 'profile-title',
      content: '─ Switch Profile ─',
      fg: '#FFFFFF',
    })
    profileBox.add(title)

    const profileSelect = new SelectRenderable(this.renderer, {
      id: 'profile-select',
      width: '100%',
      height: Math.min(this.profiles.length * 2, 10),
      options: this.profiles.map(p => ({
        name: p.name,
        description: p.id === currentProfileId ? '(current)' : '',
      })),
    })

    // Set current profile as selected
    const currentIndex = this.profiles.findIndex(p => p.id === currentProfileId)
    if (currentIndex >= 0) {
      profileSelect.setSelectedIndex(currentIndex)
    }

    profileSelect.on(SelectRenderableEvents.ITEM_SELECTED, async (index: number) => {
      const profile = this.profiles[index]
      if (profile) {
        await this.switchProfile(profile.id)
      }
      this.hideProfileSwitcher()
    })

    profileSelect.focus()
    profileBox.add(profileSelect)

    const footer = new TextRenderable(this.renderer, {
      id: 'profile-footer',
      content: '[Enter] Select  [Esc] Cancel',
      fg: '#888888',
    })
    profileBox.add(footer)

    this.profileSwitcher.add(profileBox)
    root.add(this.profileSwitcher)
  }

  private hideProfileSwitcher(): void {
    if (!this.profileSwitcher) return
    this.renderer.root.remove(this.profileSwitcher.id)
    this.profileSwitcher = null
  }

  private async switchProfile(profileId: string): Promise<void> {
    try {
      await this.client.switchProfile(profileId)
      const profile = await this.client.getCurrentProfile()
      this.state.currentProfile = profile
      this.updateStatusBar()
    } catch {
      // Ignore errors
    }
  }
}

