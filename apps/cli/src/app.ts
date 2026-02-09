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
import QRCode from 'qrcode'

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

interface CommandPaletteItem {
  id: string
  title: string
  description: string
  keywords: string[]
  run: () => Promise<void>
}

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
  private qrCodeOverlay: BoxRenderable | null = null
  private commandPaletteOverlay: BoxRenderable | null = null
  private commandPaletteBox: BoxRenderable | null = null
  private commandPaletteInput: InputRenderable | null = null
  private commandPaletteListContainer: BoxRenderable | null = null
  private commandPaletteSelect: SelectRenderable | null = null
  private commandPaletteItems: CommandPaletteItem[] = []
  private commandPaletteFilteredItems: CommandPaletteItem[] = []
  private commandPaletteSelectedIndex: number = 0
  private commandPaletteQuery: string = ''
  private statusNotice: string | null = null
  private statusNoticeTimer: ReturnType<typeof setTimeout> | null = null
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
      if (this.qrCodeOverlay) {
        this.handleQrCodeOverlayKeyPress(key)
        return
      }
      if (this.commandPaletteOverlay) {
        this.handleCommandPaletteKeyPress(key)
        return
      }
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

      // Ctrl+K - Command palette
      if (key.ctrl && key.name === 'k') {
        this.showCommandPalette()
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
    const notice = this.statusNotice ? `  |  ${this.statusNotice}` : ''
    return ` Profile: ${profile} | ${connectionIndicator}${processing}  |  [Ctrl+K] Commands  [?] Help${notice}`
  }

  private getConnectionIndicator(): string {
    switch (this.state.connectionState) {
      case 'online':
        return '* Online'
      case 'reconnecting':
        return '* Reconnecting...'
      case 'offline':
        return 'X Offline'
    }
  }

  private updateStatusBar(): void {
    this.statusBar.content = this.getStatusText()
  }

  private setStatusNotice(message: string, ttlMs: number = 4500): void {
    this.statusNotice = message
    this.updateStatusBar()
    if (this.statusNoticeTimer) {
      clearTimeout(this.statusNoticeTimer)
    }
    this.statusNoticeTimer = setTimeout(() => {
      this.statusNotice = null
      this.updateStatusBar()
      this.statusNoticeTimer = null
    }, ttlMs)
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
    if (this.statusNoticeTimer) {
      clearTimeout(this.statusNoticeTimer)
      this.statusNoticeTimer = null
    }
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
      content: '-- Keyboard Shortcuts --',
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
      '   Ctrl+K     Command palette',
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

  private handleQrCodeOverlayKeyPress(key: KeyEvent): void {
    if (key.name === 'escape' || key.name === 'enter') {
      this.hideQrCodeOverlay()
      return
    }

    const sequence = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : ''
    if (sequence === 'q') {
      this.hideQrCodeOverlay()
    }
  }

  private async showQrCodeOverlay(
    qrCodeData: string,
    sourceLabel: string,
    options?: {
      title?: string
      instructions?: string
      valueLabel?: string
      value?: string
    },
  ): Promise<void> {
    const qrText: string = await QRCode.toString(qrCodeData, {
      type: 'utf8',
      margin: 0,
    })

    if (this.qrCodeOverlay) {
      this.hideQrCodeOverlay()
    }

    const qrLines = qrText.replace(/\n$/, '').split('\n')
    const maxQrLineLength = qrLines.reduce((max: number, line: string) => Math.max(max, line.length), 0)
    const termCols = process.stdout.columns || 80
    const termRows = process.stdout.rows || 24
    const maxWidth = Math.max(40, termCols - 2)
    const maxHeight = Math.max(14, termRows - 2)
    const boxWidth = Math.min(maxWidth, Math.max(52, maxQrLineLength + 8))
    const boxHeight = Math.min(maxHeight, Math.max(18, qrLines.length + 8))

    const root = this.renderer.root
    this.qrCodeOverlay = new BoxRenderable(this.renderer, {
      id: 'qr-code-overlay',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: '#000000CC',
      justifyContent: 'center',
      alignItems: 'center',
    })

    const qrBox = new BoxRenderable(this.renderer, {
      id: 'qr-code-box',
      width: boxWidth,
      height: boxHeight,
      borderStyle: 'single',
      borderColor: '#888888',
      backgroundColor: '#1a1a1a',
      padding: 1,
      flexDirection: 'column',
    })

    const title = options?.title || '-- QR Code --'
    qrBox.add(new TextRenderable(this.renderer, {
      id: 'qr-code-title',
      content: title,
      fg: '#FFFFFF',
    }))

    qrBox.add(new TextRenderable(this.renderer, {
      id: 'qr-code-source',
      content: `Source: ${sourceLabel}`,
      fg: '#88AAFF',
    }))

    qrBox.add(new TextRenderable(this.renderer, {
      id: 'qr-code-body',
      content: qrText,
      fg: '#000000',
      bg: '#FFFFFF',
    }))

    if (options?.value) {
      const maxVisible = 76
      const displayValue = options.value.length > maxVisible
        ? `${options.value.slice(0, maxVisible - 3)}...`
        : options.value
      qrBox.add(new TextRenderable(this.renderer, {
        id: 'qr-code-value',
        content: `${options.valueLabel || 'Value'}: ${displayValue}`,
        fg: '#AAAAAA',
      }))
    }

    const instructions = options?.instructions || 'Scan this QR code with your device.'
    qrBox.add(new TextRenderable(this.renderer, {
      id: 'qr-code-instructions',
      content: instructions,
      fg: '#CCCCCC',
    }))

    qrBox.add(new TextRenderable(this.renderer, {
      id: 'qr-code-footer',
      content: '[Esc/Enter/Q] Close',
      fg: '#888888',
    }))

    this.qrCodeOverlay.add(qrBox)
    root.add(this.qrCodeOverlay)
  }

  private hideQrCodeOverlay(): void {
    if (!this.qrCodeOverlay) return
    this.renderer.root.remove(this.qrCodeOverlay.id)
    this.qrCodeOverlay = null
  }

  private parseJsonObject(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      // ignore invalid JSON
    }
    return null
  }

  private extractWhatsAppQrCode(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>

    const direct = record.qrCode
    if (typeof direct === 'string' && direct.trim().length > 0) {
      return direct
    }

    const status = record.status
    if (status && typeof status === 'object') {
      const nested = (status as Record<string, unknown>).qrCode
      if (typeof nested === 'string' && nested.trim().length > 0) {
        return nested
      }
    }

    const raw = record.raw
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const parsed = this.parseJsonObject(raw)
      const nested = parsed?.qrCode
      if (typeof nested === 'string' && nested.trim().length > 0) {
        return nested
      }
    }

    return null
  }

  private async maybeShowWhatsAppQrCode(payload: unknown, sourceLabel: string): Promise<boolean> {
    const qrCodeData = this.extractWhatsAppQrCode(payload)
    if (!qrCodeData) {
      return false
    }

    try {
      await this.showQrCodeOverlay(qrCodeData, sourceLabel, {
        title: '-- WhatsApp QR Code --',
        instructions: 'Scan with WhatsApp > Settings > Linked Devices > Link a Device',
      })
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatusNotice(`Failed to render QR code: ${message}`, 8000)
      return false
    }
  }

  private normalizeTunnelConnectUrl(candidate: unknown): string | null {
    if (typeof candidate !== 'string') return null
    const trimmed = candidate.trim()
    if (!trimmed) return null

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
      const parsed = new URL(withProtocol)
      if (!parsed.hostname) return null
      return parsed.toString()
    } catch {
      return null
    }
  }

  private extractTunnelConnectUrl(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>

    const directUrl = this.normalizeTunnelConnectUrl(record.url)
    if (directUrl) return directUrl

    const hostnameUrl = this.normalizeTunnelConnectUrl(record.hostname)
    if (hostnameUrl) return hostnameUrl

    const status = record.status
    if (status && typeof status === 'object') {
      const statusRecord = status as Record<string, unknown>
      const nestedUrl = this.normalizeTunnelConnectUrl(statusRecord.url)
      if (nestedUrl) return nestedUrl
      const nestedHostname = this.normalizeTunnelConnectUrl(statusRecord.hostname)
      if (nestedHostname) return nestedHostname
    }

    const raw = record.raw
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const parsed = this.parseJsonObject(raw)
      if (parsed) {
        const nestedUrl = this.normalizeTunnelConnectUrl(parsed.url)
        if (nestedUrl) return nestedUrl
        const nestedHostname = this.normalizeTunnelConnectUrl(parsed.hostname)
        if (nestedHostname) return nestedHostname
      }
    }

    return null
  }

  private async maybeShowTunnelQrCode(payload: unknown, sourceLabel: string): Promise<boolean> {
    const tunnelUrl = this.extractTunnelConnectUrl(payload)
    if (!tunnelUrl) return false

    try {
      await this.showQrCodeOverlay(tunnelUrl, sourceLabel, {
        title: '-- Cloudflare Tunnel QR --',
        instructions: 'Scan to open tunnel URL in your app or browser.',
        valueLabel: 'URL',
        value: tunnelUrl,
      })
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatusNotice(`Failed to render tunnel QR: ${message}`, 8000)
      return false
    }
  }

  private async waitForTunnelConnectUrl(timeoutMs: number = 12000, intervalMs: number = 1200): Promise<string | null> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      try {
        const status = await this.client.getTunnelStatus()
        const connectUrl = this.extractTunnelConnectUrl(status)
        if (connectUrl) return connectUrl
        if (!status.running && !status.starting) return null
      } catch {
        return null
      }
    }
    return null
  }

  // Command palette
  private showCommandPalette(): void {
    if (this.commandPaletteOverlay) return

    this.commandPaletteItems = this.buildCommandPaletteItems()
    this.commandPaletteQuery = ''
    this.commandPaletteSelectedIndex = 0
    this.commandPaletteFilteredItems = [...this.commandPaletteItems]

    const root = this.renderer.root
    this.commandPaletteOverlay = new BoxRenderable(this.renderer, {
      id: 'command-palette-overlay',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: '#000000CC',
      justifyContent: 'center',
      alignItems: 'center',
    })

    this.commandPaletteBox = new BoxRenderable(this.renderer, {
      id: 'command-palette-box',
      width: 74,
      height: 22,
      borderStyle: 'single',
      borderColor: '#888888',
      backgroundColor: '#1a1a1a',
      padding: 1,
      flexDirection: 'column',
    })

    const title = new TextRenderable(this.renderer, {
      id: 'command-palette-title',
      content: '-- Command Palette --',
      fg: '#FFFFFF',
    })
    this.commandPaletteBox.add(title)

    const inputRow = new BoxRenderable(this.renderer, {
      id: 'command-palette-input-row',
      width: '100%',
      height: 1,
      flexDirection: 'row',
      marginTop: 1,
      marginBottom: 1,
    })
    inputRow.add(new TextRenderable(this.renderer, {
      id: 'command-palette-input-label',
      content: ' > ',
      fg: '#66AAFF',
    }))

    this.commandPaletteInput = new InputRenderable(this.renderer, {
      id: 'command-palette-input',
      width: 66,
      height: 1,
      placeholder: 'Search commands...',
      focusedBackgroundColor: '#2a2a2a',
    })
    this.commandPaletteInput.on(InputRenderableEvents.CHANGE, (value: string) => {
      this.commandPaletteQuery = value
      this.commandPaletteSelectedIndex = 0
      this.refreshCommandPaletteList()
    })
    this.commandPaletteInput.on(InputRenderableEvents.ENTER, () => {
      void this.executeSelectedCommandPaletteItem()
    })
    inputRow.add(this.commandPaletteInput)
    this.commandPaletteBox.add(inputRow)

    this.commandPaletteListContainer = new BoxRenderable(this.renderer, {
      id: 'command-palette-list-container',
      width: '100%',
      flexGrow: 1,
    })
    this.commandPaletteBox.add(this.commandPaletteListContainer)

    const footer = new TextRenderable(this.renderer, {
      id: 'command-palette-footer',
      content: '[Enter] Run  [Up/Down] Navigate  [Esc] Close',
      fg: '#888888',
    })
    this.commandPaletteBox.add(footer)

    this.commandPaletteOverlay.add(this.commandPaletteBox)
    root.add(this.commandPaletteOverlay)

    this.refreshCommandPaletteList()
    setTimeout(() => this.commandPaletteInput?.focus(), 0)
  }

  private hideCommandPalette(): void {
    if (!this.commandPaletteOverlay) return
    this.renderer.root.remove(this.commandPaletteOverlay.id)
    this.commandPaletteOverlay = null
    this.commandPaletteBox = null
    this.commandPaletteInput = null
    this.commandPaletteListContainer = null
    this.commandPaletteSelect = null
    this.commandPaletteItems = []
    this.commandPaletteFilteredItems = []
    this.commandPaletteSelectedIndex = 0
    this.commandPaletteQuery = ''
  }

  private handleCommandPaletteKeyPress(key: KeyEvent): void {
    if (key.ctrl && key.name === 'k') {
      this.hideCommandPalette()
      return
    }
    if (key.name === 'escape') {
      this.hideCommandPalette()
      return
    }
    if (key.name === 'up') {
      this.moveCommandPaletteSelection(-1)
      return
    }
    if (key.name === 'down') {
      this.moveCommandPaletteSelection(1)
      return
    }
    if (key.name === 'enter') {
      void this.executeSelectedCommandPaletteItem()
      return
    }
  }

  private moveCommandPaletteSelection(delta: number): void {
    if (this.commandPaletteFilteredItems.length === 0) return
    const count = this.commandPaletteFilteredItems.length
    this.commandPaletteSelectedIndex = (this.commandPaletteSelectedIndex + delta + count) % count
    this.commandPaletteSelect?.setSelectedIndex(this.commandPaletteSelectedIndex)
  }

  private refreshCommandPaletteList(): void {
    if (!this.commandPaletteListContainer) return

    const children = this.commandPaletteListContainer.getChildren()
    for (const child of children) {
      this.commandPaletteListContainer.remove(child.id)
    }

    const query = this.commandPaletteQuery.trim().toLowerCase()
    this.commandPaletteFilteredItems = this.commandPaletteItems.filter((item) => {
      if (!query) return true
      return (
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.keywords.some((keyword) => keyword.includes(query))
      )
    })

    if (this.commandPaletteFilteredItems.length === 0) {
      this.commandPaletteListContainer.add(new TextRenderable(this.renderer, {
        id: 'command-palette-empty',
        content: 'No commands match your search.',
        fg: '#888888',
      }))
      this.commandPaletteSelect = null
      return
    }

    if (this.commandPaletteSelectedIndex >= this.commandPaletteFilteredItems.length) {
      this.commandPaletteSelectedIndex = this.commandPaletteFilteredItems.length - 1
    }

    this.commandPaletteSelect = new SelectRenderable(this.renderer, {
      id: 'command-palette-select',
      width: '100%',
      height: Math.min(16, Math.max(4, this.commandPaletteFilteredItems.length * 2)),
      options: this.commandPaletteFilteredItems.map((item) => ({
        name: item.title,
        description: item.description,
      })),
    })
    this.commandPaletteSelect.setSelectedIndex(this.commandPaletteSelectedIndex)
    this.commandPaletteSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      this.commandPaletteSelectedIndex = index
      void this.executeSelectedCommandPaletteItem()
    })
    this.commandPaletteListContainer.add(this.commandPaletteSelect)
  }

  private async executeSelectedCommandPaletteItem(): Promise<void> {
    const command = this.commandPaletteFilteredItems[this.commandPaletteSelectedIndex]
    if (!command) return

    this.hideCommandPalette()
    try {
      await command.run()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatusNotice(`Command failed: ${message}`, 7000)
    }
  }

  private logCommandOutput(label: string, payload: unknown): void {
    console.log(`\\n--- ${label} ---`)
    if (typeof payload === 'string') {
      console.log(payload)
    } else {
      console.log(JSON.stringify(payload, null, 2))
    }
    console.log(`--- End ${label} ---\\n`)
  }

  private async getLastAssistantMessageForCurrentConversation(): Promise<string | null> {
    if (!this.state.currentConversationId) return null
    const conversation = await this.client.getConversation(this.state.currentConversationId)
    const latestAssistant = [...conversation.messages].reverse().find(
      (message) => message.role === 'assistant' && message.content.trim().length > 0,
    )
    return latestAssistant?.content || null
  }

  private buildCommandPaletteItems(): CommandPaletteItem[] {
    return [
      {
        id: 'view-chat',
        title: 'View: Chat',
        description: 'Switch to chat view',
        keywords: ['view', 'chat', 'f1'],
        run: async () => {
          await this.switchView('chat')
        },
      },
      {
        id: 'view-sessions',
        title: 'View: Sessions',
        description: 'Switch to sessions view',
        keywords: ['view', 'sessions', 'f2'],
        run: async () => {
          await this.switchView('sessions')
        },
      },
      {
        id: 'view-settings',
        title: 'View: Settings',
        description: 'Switch to settings view',
        keywords: ['view', 'settings', 'f3'],
        run: async () => {
          await this.switchView('settings')
        },
      },
      {
        id: 'settings-remote-server',
        title: 'Settings: Remote Server',
        description: 'Open tunnel/remote-server controls and current status',
        keywords: ['settings', 'remote', 'server', 'tunnel', 'cloudflared'],
        run: async () => {
          await this.switchView('settings')
          const result = await this.client.getTunnelStatus()
          this.logCommandOutput('Settings Remote Server', result)
          if (await this.maybeShowTunnelQrCode(result, 'settings remote server')) {
            this.setStatusNotice('Remote server URL QR ready. Scan and press Esc when done.', 9000)
            return
          }
          this.setStatusNotice(`Remote server/tunnel ${result.running ? 'running' : 'stopped'} (details in console)`)
        },
      },
      {
        id: 'settings-profiles',
        title: 'Settings: Profiles',
        description: 'Open profile manager (select/create/edit/delete/import/export)',
        keywords: ['settings', 'profiles', 'profile'],
        run: async () => {
          await this.switchView('settings')
          await this.showProfileSwitcher()
          this.setStatusNotice('Profile manager opened')
        },
      },
      {
        id: 'settings-personas',
        title: 'Settings: Personas',
        description: 'List agent personas for delegation settings',
        keywords: ['settings', 'personas', 'agent', 'delegation'],
        run: async () => {
          await this.switchView('settings')
          const result = await this.client.getAgentPersonas()
          this.logCommandOutput('Settings Personas', result)
          this.setStatusNotice(`Personas loaded: ${result.personas.length} (details in console)`)
        },
      },
      {
        id: 'settings-memories',
        title: 'Settings: Memories',
        description: 'Inspect memory inventory and controls',
        keywords: ['settings', 'memories', 'memory'],
        run: async () => {
          await this.switchView('settings')
          const result = await this.client.getMemories()
          this.logCommandOutput('Settings Memories', result)
          this.setStatusNotice(`Memories loaded: ${result.memories.length} (details in console)`)
        },
      },
      {
        id: 'settings-skills',
        title: 'Settings: Skills',
        description: 'Inspect skills inventory and import/export surfaces',
        keywords: ['settings', 'skills', 'skill'],
        run: async () => {
          await this.switchView('settings')
          const result = await this.client.getSkills()
          this.logCommandOutput('Settings Skills', result)
          this.setStatusNotice(`Skills loaded: ${result.skills.length} (details in console)`)
        },
      },
      {
        id: 'settings-diagnostics',
        title: 'Settings: Diagnostics',
        description: 'Run diagnostics report from settings surface',
        keywords: ['settings', 'diagnostics', 'health', 'report'],
        run: async () => {
          await this.switchView('settings')
          const result = await this.client.getDiagnosticReport()
          this.logCommandOutput('Settings Diagnostics', result)
          this.setStatusNotice('Diagnostics report fetched (details in console)')
        },
      },
      {
        id: 'view-tools',
        title: 'View: Tools',
        description: 'Switch to tools view',
        keywords: ['view', 'tools', 'f4'],
        run: async () => {
          await this.switchView('tools')
        },
      },
      {
        id: 'memories-list',
        title: 'Memories: List',
        description: 'Fetch and print saved memories',
        keywords: ['memories', 'memory', 'list'],
        run: async () => {
          const result = await this.client.getMemories()
          this.logCommandOutput('Memories', result)
          this.setStatusNotice(`Memories loaded: ${result.memories.length} (details in console)`)
        },
      },
      {
        id: 'skills-list',
        title: 'Skills: List',
        description: 'Fetch and print skills catalog',
        keywords: ['skills', 'list', 'import'],
        run: async () => {
          const result = await this.client.getSkills()
          this.logCommandOutput('Skills', result)
          this.setStatusNotice(`Skills loaded: ${result.skills.length} (details in console)`)
        },
      },
      {
        id: 'diagnostics-health',
        title: 'Diagnostics: Health',
        description: 'Run health check and print result',
        keywords: ['diagnostics', 'health', 'report'],
        run: async () => {
          const result = await this.client.getHealthCheck()
          this.logCommandOutput('Diagnostics Health', result)
          this.setStatusNotice(`Diagnostics: ${result.overall} (details in console)`)
        },
      },
      {
        id: 'queue-all',
        title: 'Queue: List all queues',
        description: 'Fetch grouped queue state',
        keywords: ['queue', 'list', 'pause', 'retry'],
        run: async () => {
          const result = await this.client.getAllQueues()
          this.logCommandOutput('Message Queues', result)
          this.setStatusNotice(`Queue groups: ${result.queues.length} (details in console)`)
        },
      },
      {
        id: 'queue-pause-current',
        title: 'Queue: Pause current conversation',
        description: 'Pause queue processing for active conversation',
        keywords: ['queue', 'pause', 'conversation'],
        run: async () => {
          if (!this.state.currentConversationId) {
            this.setStatusNotice('No active conversation to pause')
            return
          }
          await this.client.pauseQueue(this.state.currentConversationId)
          this.setStatusNotice(`Queue paused for ${this.state.currentConversationId}`)
        },
      },
      {
        id: 'queue-resume-current',
        title: 'Queue: Resume current conversation',
        description: 'Resume queue processing for active conversation',
        keywords: ['queue', 'resume', 'conversation'],
        run: async () => {
          if (!this.state.currentConversationId) {
            this.setStatusNotice('No active conversation to resume')
            return
          }
          await this.client.resumeQueue(this.state.currentConversationId)
          this.setStatusNotice(`Queue resumed for ${this.state.currentConversationId}`)
        },
      },
      {
        id: 'agent-sessions-list',
        title: 'Agent Sessions: List',
        description: 'Fetch current agent sessions',
        keywords: ['agent', 'sessions', 'snooze', 'stop'],
        run: async () => {
          const result = await this.client.getAgentSessions()
          this.logCommandOutput('Agent Sessions', result)
          this.setStatusNotice(`Agent sessions: ${result.activeCount} active (details in console)`)
        },
      },
      {
        id: 'agent-sessions-stop-all',
        title: 'Agent Sessions: Stop all',
        description: 'Emergency stop all running sessions',
        keywords: ['agent', 'sessions', 'stop', 'kill'],
        run: async () => {
          await this.client.stopAllAgentSessions()
          this.setStatusNotice('All agent sessions stopped')
        },
      },
      {
        id: 'personas-list',
        title: 'Personas: List delegation targets',
        description: 'Fetch agent personas',
        keywords: ['personas', 'delegation', 'agents'],
        run: async () => {
          const result = await this.client.getAgentPersonas()
          this.logCommandOutput('Agent Personas', result)
          this.setStatusNotice(`Personas loaded: ${result.personas.length}`)
        },
      },
      {
        id: 'external-agents-list',
        title: 'External Agents: List',
        description: 'Fetch external-agent profiles',
        keywords: ['external', 'agents', 'profiles'],
        run: async () => {
          const result = await this.client.getExternalAgents()
          this.logCommandOutput('External Agents', result)
          this.setStatusNotice(`External agents loaded: ${result.externalAgents.length}`)
        },
      },
      {
        id: 'whatsapp-status',
        title: 'WhatsApp: Status',
        description: 'Fetch WhatsApp connection status',
        keywords: ['whatsapp', 'status', 'qr'],
        run: async () => {
          const result = await this.client.getWhatsAppStatus()
          this.logCommandOutput('WhatsApp Status', result)
          if (await this.maybeShowWhatsAppQrCode(result, 'whatsapp status')) {
            this.setStatusNotice('WhatsApp QR ready. Scan and press Esc when done.', 9000)
            return
          }
          this.setStatusNotice('WhatsApp status fetched (details in console)')
        },
      },
      {
        id: 'whatsapp-connect',
        title: 'WhatsApp: Connect',
        description: 'Start WhatsApp connect flow (QR if required)',
        keywords: ['whatsapp', 'connect', 'qr'],
        run: async () => {
          const result = await this.client.connectWhatsApp()
          this.logCommandOutput('WhatsApp Connect', result)
          if (await this.maybeShowWhatsAppQrCode(result, 'whatsapp connect')) {
            this.setStatusNotice('WhatsApp QR ready. Scan and press Esc when done.', 9000)
            return
          }
          this.setStatusNotice('WhatsApp connect requested (details in console)')
        },
      },
      {
        id: 'whatsapp-disconnect',
        title: 'WhatsApp: Disconnect',
        description: 'Disconnect without logout',
        keywords: ['whatsapp', 'disconnect'],
        run: async () => {
          const result = await this.client.disconnectWhatsApp()
          this.logCommandOutput('WhatsApp Disconnect', result)
          this.setStatusNotice('WhatsApp disconnect requested')
        },
      },
      {
        id: 'whatsapp-logout',
        title: 'WhatsApp: Logout',
        description: 'Logout and clear WhatsApp auth',
        keywords: ['whatsapp', 'logout'],
        run: async () => {
          const result = await this.client.logoutWhatsApp()
          this.logCommandOutput('WhatsApp Logout', result)
          this.setStatusNotice('WhatsApp logout requested')
        },
      },
      {
        id: 'tunnel-status',
        title: 'Tunnel: Status',
        description: 'Fetch tunnel runtime status',
        keywords: ['tunnel', 'status', 'cloudflared', 'qr', 'connect'],
        run: async () => {
          const result = await this.client.getTunnelStatus()
          this.logCommandOutput('Tunnel Status', result)
          if (await this.maybeShowTunnelQrCode(result, 'tunnel status')) {
            this.setStatusNotice('Tunnel URL QR ready. Scan and press Esc when done.', 9000)
            return
          }
          this.setStatusNotice(`Tunnel ${result.running ? 'running' : 'stopped'} (details in console)`)
        },
      },
      {
        id: 'tunnel-start-quick',
        title: 'Tunnel: Start quick tunnel',
        description: 'Start cloudflared quick tunnel',
        keywords: ['tunnel', 'start', 'quick', 'qr', 'connect'],
        run: async () => {
          const result = await this.client.startTunnel({ mode: 'quick' })
          this.logCommandOutput('Tunnel Start', result)
          if (await this.maybeShowTunnelQrCode(result, 'tunnel start')) {
            this.setStatusNotice('Tunnel URL QR ready. Scan and press Esc when done.', 9000)
            return
          }

          const postStartUrl = await this.waitForTunnelConnectUrl()
          if (postStartUrl && await this.maybeShowTunnelQrCode({ url: postStartUrl }, 'tunnel start (ready)')) {
            this.setStatusNotice('Tunnel URL QR ready. Scan and press Esc when done.', 9000)
            return
          }

          this.setStatusNotice('Tunnel started. Run Tunnel: Status for URL/QR once ready.', 9000)
        },
      },
      {
        id: 'tunnel-stop',
        title: 'Tunnel: Stop',
        description: 'Stop running cloudflared tunnel',
        keywords: ['tunnel', 'stop'],
        run: async () => {
          const result = await this.client.stopTunnel()
          this.logCommandOutput('Tunnel Stop', result)
          this.setStatusNotice('Tunnel stop requested')
        },
      },
      {
        id: 'tunnel-list',
        title: 'Tunnel: List configured tunnels',
        description: 'Run cloudflared tunnel list',
        keywords: ['tunnel', 'list'],
        run: async () => {
          const result = await this.client.listTunnels()
          this.logCommandOutput('Tunnel List', result)
          this.setStatusNotice(`Tunnels listed: ${result.tunnels.length}`)
        },
      },
      {
        id: 'tts-generate-last-assistant',
        title: 'TTS: Generate from latest assistant reply',
        description: 'Generate audio file from current conversation',
        keywords: ['tts', 'audio', 'speech'],
        run: async () => {
          const lastAssistantMessage = await this.getLastAssistantMessageForCurrentConversation()
          if (!lastAssistantMessage) {
            this.setStatusNotice('No assistant message available for TTS')
            return
          }
          const result = await this.client.generateTTS({ text: lastAssistantMessage })
          this.logCommandOutput('TTS Generation', result)
          this.setStatusNotice(`TTS file created: ${result.file.name}`)
        },
      },
    ]
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
      content: '-- Profiles --',
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
