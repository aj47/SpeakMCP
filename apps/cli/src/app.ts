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
  InputRenderable,
  InputRenderableEvents,
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
  private profileSelectedIndex: number = 0
  private profileSelectRenderable: SelectRenderable | null = null
  private currentProfileId: string | undefined
  private profileInputMode: 'create' | 'edit' | 'import' | null = null
  private profileInput: InputRenderable | null = null
  private profileBox: BoxRenderable | null = null

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
        // If in input mode (create/edit/import), only handle Escape
        if (this.profileInputMode) {
          if (key.name === 'escape') {
            this.profileInputMode = null
            this.profileInput = null
            this.hideProfileSwitcher()
            this.showProfileSwitcher()
          }
          // Let the input handle all other keys
          return
        }

        if (key.name === 'escape') {
          this.hideProfileSwitcher()
          return
        }

        // Navigation
        if (key.name === 'up') {
          this.profileNavigateUp()
          return
        }
        if (key.name === 'down') {
          this.profileNavigateDown()
          return
        }
        if (key.name === 'enter') {
          this.selectCurrentProfile()
          return
        }

        // Profile CRUD and export/import keybindings
        const ch = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : ''
        switch (ch) {
          case 'c': this.createProfilePrompt(); break
          case 'e': this.editProfilePrompt(); break
          case 'd': this.deleteSelectedProfile(); break
          case 'x': this.exportSelectedProfile(); break
          case 'i': this.importProfilePrompt(); break
        }
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

      // ? or F12 - Help overlay (blur input first to prevent double-handling)
      if (key.name === '?' || key.sequence === '?' || key.name === 'f12') {
        // Blur any focused input to prevent the '?' character from being typed
        if (this.state.currentView === 'chat') {
          this.chatView.blurInput()
        }
        this.showHelpOverlay()
        return
      }

      // Escape - Cancel / Go back (forward to current view)
      if (key.name === 'escape') {
        this.handleEscape()
        return
      }

      // F-keys for view switching (with fallback escape sequences for iTerm2)
      // Standard xterm: F1=\eOP, F2=\eOQ, F3=\eOR, F4=\eOS
      // VT220 mode: F1=\e[11~, F2=\e[12~, F3=\e[13~, F4=\e[14~
      if (key.name === 'f1' || key.sequence === '\x1bOP' || key.sequence === '\x1b[11~') {
        this.switchView('chat')
        return
      }
      if (key.name === 'f2' || key.sequence === '\x1bOQ' || key.sequence === '\x1b[12~') {
        this.switchView('sessions')
        return
      }
      if (key.name === 'f3' || key.sequence === '\x1bOR' || key.sequence === '\x1b[13~') {
        this.switchView('settings')
        return
      }
      if (key.name === 'f4' || key.sequence === '\x1bOS' || key.sequence === '\x1b[14~') {
        this.switchView('tools')
        return
      }

      // Alt+number alternatives for terminals where F-keys don't work
      if (key.meta && key.sequence) {
        if (key.name === '1' || key.sequence === '\x1b1') { this.switchView('chat'); return }
        if (key.name === '2' || key.sequence === '\x1b2') { this.switchView('sessions'); return }
        if (key.name === '3' || key.sequence === '\x1b3') { this.switchView('settings'); return }
        if (key.name === '4' || key.sequence === '\x1b4') { this.switchView('tools'); return }
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
    return ` Profile: ${profile} │ ${connectionIndicator}${processing}  │  [?] Help`
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

  // Handle Escape key - forward to current view
  private handleEscape(): void {
    switch (this.state.currentView) {
      case 'settings':
        this.settingsView.handleKeyPress({ name: 'escape', sequence: '\x1b' } as KeyEvent)
        break
      case 'sessions':
        this.sessionsView.handleKeyPress({ name: 'escape', sequence: '\x1b' } as KeyEvent)
        break
      case 'chat':
        this.chatView.handleKeyPress({ name: 'escape', sequence: '\x1b' } as KeyEvent)
        break
      case 'tools':
        this.toolsView.handleKeyPress({ name: 'escape', sequence: '\x1b' } as KeyEvent)
        break
    }
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
        this.settingsView.handleKeyPress(key)
        break
      case 'tools':
        this.toolsView.handleKeyPress(key)
        break
    }
  }

  // Help overlay
  private showHelpOverlay(): void {
    if (this.helpOverlay) return

    const root = this.renderer.root

    // Create overlay background (absolute position to cover entire screen)
    this.helpOverlay = new BoxRenderable(this.renderer, {
      id: 'help-overlay',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: '#000000CC',
      justifyContent: 'center',
      alignItems: 'center',
    })

    // Create help box (cap height to terminal size)
    const termRows = process.stdout.rows || 24
    const helpBoxHeight = Math.min(24, termRows - 4)
    const helpBox = new BoxRenderable(this.renderer, {
      id: 'help-box',
      width: 52,
      height: helpBoxHeight,
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
      '   F1-F4      Switch views (or Alt+1-4)',
      '   Ctrl+N     New conversation',
      '   Ctrl+P     Profiles (C/E/D/X/I)',
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
    if (this.profileSwitcher) {
      this.hideProfileSwitcher()
    }

    // Load profiles
    try {
      const result = await this.client.getProfiles()
      this.profiles = result.profiles || []
      this.currentProfileId = result.currentProfileId
    } catch {
      this.profiles = []
    }

    const root = this.renderer.root

    // Create overlay (absolute position to cover entire screen)
    this.profileSwitcher = new BoxRenderable(this.renderer, {
      id: 'profile-overlay',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: '#000000CC',
      justifyContent: 'center',
      alignItems: 'center',
    })

    // Create profile box (cap height to terminal size)
    const termRows = process.stdout.rows || 24
    const maxBoxHeight = termRows - 4
    const boxHeight = Math.min(this.profiles.length + 6, 18, maxBoxHeight)
    this.profileBox = new BoxRenderable(this.renderer, {
      id: 'profile-box',
      width: 62,
      height: boxHeight,
      borderStyle: 'single',
      borderColor: '#888888',
      backgroundColor: '#1a1a1a',
      padding: 1,
      flexDirection: 'column',
    })

    const title = new TextRenderable(this.renderer, {
      id: 'profile-title',
      content: '─ Profiles ─',
      fg: '#FFFFFF',
    })
    this.profileBox.add(title)

    if (this.profiles.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'profile-empty',
        content: 'No profiles. Press [C] to create one.',
        fg: '#888888',
      })
      this.profileBox.add(emptyText)
    } else {
      const profileSelect = new SelectRenderable(this.renderer, {
        id: 'profile-select',
        width: '100%',
        height: Math.min(this.profiles.length * 2, 10),
        options: this.profiles.map(p => ({
          name: p.name,
          description: p.id === this.currentProfileId ? '(current)' : '',
        })),
      })

      // Clamp selected index
      if (this.profileSelectedIndex >= this.profiles.length) {
        this.profileSelectedIndex = Math.max(0, this.profiles.length - 1)
      }
      profileSelect.setSelectedIndex(this.profileSelectedIndex)

      // Don't focus — we handle navigation manually to avoid double-handling
      this.profileSelectRenderable = profileSelect
      this.profileBox.add(profileSelect)
    }

    const footer = new TextRenderable(this.renderer, {
      id: 'profile-footer',
      content: '[Enter] Select [C]reate [E]dit [D]elete [X]port [I]mport',
      fg: '#888888',
    })
    this.profileBox.add(footer)

    this.profileSwitcher.add(this.profileBox)
    root.add(this.profileSwitcher)
  }

  private hideProfileSwitcher(): void {
    if (!this.profileSwitcher) return
    this.renderer.root.remove(this.profileSwitcher.id)
    this.profileSwitcher = null
    this.profileBox = null
    this.profileSelectRenderable = null
    this.profileInputMode = null
    this.profileInput = null
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

  // Profile navigation
  private profileNavigateUp(): void {
    if (this.profiles.length === 0) return
    this.profileSelectedIndex = Math.max(0, this.profileSelectedIndex - 1)
    this.profileSelectRenderable?.setSelectedIndex(this.profileSelectedIndex)
  }

  private profileNavigateDown(): void {
    if (this.profiles.length === 0) return
    this.profileSelectedIndex = Math.min(this.profiles.length - 1, this.profileSelectedIndex + 1)
    this.profileSelectRenderable?.setSelectedIndex(this.profileSelectedIndex)
  }

  private async selectCurrentProfile(): Promise<void> {
    const profile = this.profiles[this.profileSelectedIndex]
    if (profile) {
      await this.switchProfile(profile.id)
    }
    this.hideProfileSwitcher()
  }

  // G-10: Profile CRUD
  private async createProfilePrompt(): Promise<void> {
    if (!this.profileBox) return
    this.profileInputMode = 'create'

    // Remove existing footer and add input
    this.profileBox.remove('profile-footer')

    const label = new TextRenderable(this.renderer, {
      id: 'profile-input-label',
      content: '  New profile name:',
      fg: '#FFAA66',
    })
    this.profileBox.add(label)

    this.profileInput = new InputRenderable(this.renderer, {
      id: 'profile-name-input',
      width: 40,
      height: 1,
      placeholder: 'Enter profile name...',
      focusedBackgroundColor: '#2a2a2a',
    })
    this.profileInput.on(InputRenderableEvents.ENTER, async (value: string) => {
      const name = value.trim()
      if (name) {
        try {
          await this.client.createProfile(name, '')
        } catch {
          // Ignore
        }
      }
      this.profileInputMode = null
      this.profileInput = null
      this.hideProfileSwitcher()
      await this.showProfileSwitcher()
    })
    this.profileBox.add(this.profileInput)

    const hint = new TextRenderable(this.renderer, {
      id: 'profile-input-hint',
      content: '  [Enter] Create  [Esc] Cancel',
      fg: '#888888',
    })
    this.profileBox.add(hint)

    setTimeout(() => this.profileInput?.focus(), 0)
  }

  private async editProfilePrompt(): Promise<void> {
    const profile = this.profiles[this.profileSelectedIndex]
    if (!profile || !this.profileBox) return
    this.profileInputMode = 'edit'

    // Remove existing footer and add input
    this.profileBox.remove('profile-footer')

    const label = new TextRenderable(this.renderer, {
      id: 'profile-input-label',
      content: `  Rename "${profile.name}":`,
      fg: '#FFAA66',
    })
    this.profileBox.add(label)

    this.profileInput = new InputRenderable(this.renderer, {
      id: 'profile-name-input',
      width: 40,
      height: 1,
      placeholder: profile.name,
      focusedBackgroundColor: '#2a2a2a',
    })
    this.profileInput.on(InputRenderableEvents.ENTER, async (value: string) => {
      const newName = value.trim()
      if (newName && newName !== profile.name) {
        try {
          await this.client.updateProfile(profile.id, { name: newName })
        } catch {
          // Ignore
        }
      }
      this.profileInputMode = null
      this.profileInput = null
      this.hideProfileSwitcher()
      await this.showProfileSwitcher()
    })
    this.profileBox.add(this.profileInput)

    const hint = new TextRenderable(this.renderer, {
      id: 'profile-input-hint',
      content: '  [Enter] Save  [Esc] Cancel',
      fg: '#888888',
    })
    this.profileBox.add(hint)

    setTimeout(() => this.profileInput?.focus(), 0)
  }

  private async deleteSelectedProfile(): Promise<void> {
    const profile = this.profiles[this.profileSelectedIndex]
    if (!profile) return

    // Don't allow deleting the current or default profile
    if (profile.id === this.currentProfileId) return
    if ((profile as unknown as { isDefault?: boolean }).isDefault) return

    try {
      await this.client.deleteProfile(profile.id)
    } catch {
      // Silently ignore delete errors
    }

    this.hideProfileSwitcher()
    await this.showProfileSwitcher()
  }

  // G-09: Profile Export/Import
  private async exportSelectedProfile(): Promise<void> {
    const profile = this.profiles[this.profileSelectedIndex]
    if (!profile || !this.profileBox) return

    try {
      const result = await this.client.exportProfile(profile.id)
      const json = typeof result.profileJson === 'string'
        ? result.profileJson
        : JSON.stringify(result, null, 2)
      const truncated = json.length > 200 ? json.substring(0, 197) + '...' : json

      // Show export result in the profile box
      this.profileBox.remove('profile-footer')

      const exportText = new TextRenderable(this.renderer, {
        id: 'profile-export-text',
        content: `  Exported "${profile.name}":\n  ${truncated}`,
        fg: '#88FF88',
      })
      this.profileBox.add(exportText)

      const hint = new TextRenderable(this.renderer, {
        id: 'profile-export-hint',
        content: '  (JSON logged to console) [Esc] Close',
        fg: '#888888',
      })
      this.profileBox.add(hint)

      // Log full JSON to stdout for copy-paste
      console.log('\n--- Profile Export ---')
      console.log(json)
      console.log('--- End Export ---\n')
    } catch {
      // Ignore
    }
  }

  private async importProfilePrompt(): Promise<void> {
    if (!this.profileBox) return
    this.profileInputMode = 'import'

    this.profileBox.remove('profile-footer')

    const label = new TextRenderable(this.renderer, {
      id: 'profile-input-label',
      content: '  Paste profile JSON:',
      fg: '#FFAA66',
    })
    this.profileBox.add(label)

    this.profileInput = new InputRenderable(this.renderer, {
      id: 'profile-json-input',
      width: 45,
      height: 1,
      placeholder: '{"name":"...","guidelines":"..."}',
      focusedBackgroundColor: '#2a2a2a',
    })
    this.profileInput.on(InputRenderableEvents.ENTER, async (value: string) => {
      const json = value.trim()
      if (json) {
        try {
          await this.client.importProfile(json)
        } catch {
          // Ignore
        }
      }
      this.profileInputMode = null
      this.profileInput = null
      this.hideProfileSwitcher()
      await this.showProfileSwitcher()
    })
    this.profileBox.add(this.profileInput)

    const hint = new TextRenderable(this.renderer, {
      id: 'profile-input-hint',
      content: '  [Enter] Import  [Esc] Cancel',
      fg: '#888888',
    })
    this.profileBox.add(hint)

    setTimeout(() => this.profileInput?.focus(), 0)
  }
}

