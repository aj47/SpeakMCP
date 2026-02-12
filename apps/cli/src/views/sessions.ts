/**
 * Sessions View - Browse and manage conversation history
 */

import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
} from '@opentui/core'

import { BaseView } from './base'
import type { Conversation } from '../types'

export class SessionsView extends BaseView {
  private sessions: Conversation[] = []
  private filteredSessions: Conversation[] = []
  private selectList: SelectRenderable | null = null
  private selectedIndex: number = 0
  private searchMode: boolean = false
  private searchInput: InputRenderable | null = null
  private searchQuery: string = ''
  private onSwitchToChat?: (conversationId?: string) => Promise<void>

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    // Load sessions
    await this.loadSessions()

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)

    // Note: Do NOT call this.selectList.focus() here.
    // SelectRenderable handles its own up/down keys when focused,
    // which conflicts with the manual navigation in handleKeyPress(),
    // causing arrow keys to jump 2 positions instead of 1.
  }

  protected async createContent(): Promise<BoxRenderable> {
    const view = new BoxRenderable(this.renderer, {
      id: 'sessions-view',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })

    // Header
    const header = new BoxRenderable(this.renderer, {
      id: 'sessions-header',
      width: '100%',
      height: 1,
      backgroundColor: '#1a2e1a',
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'sessions-header-text',
      content: ` Sessions (${this.sessions.length})          [/] Search  [N] New  [E] Edit  [D] Delete  [Enter] Open`,
      fg: '#FFFFFF',
    })
    header.add(headerText)
    view.add(header)

    // Search bar (initially hidden, shown on / key)
    const searchBar = new BoxRenderable(this.renderer, {
      id: 'search-bar',
      width: '100%',
      height: this.searchMode ? 1 : 0,
      flexDirection: 'row',
      padding: 0,
    })

    if (this.searchMode) {
      const searchLabel = new TextRenderable(this.renderer, {
        id: 'search-label',
        content: ' > ',
        fg: '#FFAA66',
        height: 1,
      })
      searchBar.add(searchLabel)

      this.searchInput = new InputRenderable(this.renderer, {
        id: 'search-input',
        width: 40,
        height: 1,
        placeholder: 'Search conversations...',
        focusedBackgroundColor: '#2a2a2a',
      })
      if (this.searchQuery) {
        this.searchInput.value = this.searchQuery
      }
      this.searchInput.on(InputRenderableEvents.CHANGE, (value: string) => {
        this.searchQuery = value
        this.filterSessions()
        this.refreshList()
      })
      searchBar.add(this.searchInput)
      // Auto-focus when in search mode
      setTimeout(() => this.searchInput?.focus(), 0)
    }

    view.add(searchBar)

    // Sessions list
    const listContainer = new BoxRenderable(this.renderer, {
      id: 'sessions-list-container',
      flexGrow: 1,
      width: '100%',
      padding: 1,
    })

    const displaySessions = this.searchMode ? this.filteredSessions : this.sessions

    if (displaySessions.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'no-sessions',
        content: this.searchMode
          ? `No conversations matching "${this.searchQuery}"`
          : 'No conversations yet. Press [N] or switch to Chat to start one.',
        fg: '#888888',
        height: 1,
      })
      listContainer.add(emptyText)
    } else {
      const options = displaySessions.map(s => ({
        name: this.getSessionTitle(s),
        description: this.getSessionAge(s),
      }))

      this.selectList = new SelectRenderable(this.renderer, {
        id: 'sessions-list',
        width: '100%',
        height: Math.min(displaySessions.length * 2 + 2, 20),
        options,
      })

      this.selectList.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
        const session = displaySessions[index]
        if (session) {
          this.resumeSession(session.id)
        }
      })

      listContainer.add(this.selectList)
    }

    view.add(listContainer)

    // Footer with keybindings
    const footer = new BoxRenderable(this.renderer, {
      id: 'sessions-footer',
      width: '100%',
      height: 1,
      backgroundColor: '#333333',
    })
    const footerText = new TextRenderable(this.renderer, {
      id: 'sessions-footer-text',
      content: ' [Enter] Open  [N] Create  [E] Edit  [D] Delete  [/] Search',
      fg: '#AAAAAA',
    })
    footer.add(footerText)
    view.add(footer)

    return view
  }

  private async loadSessions(): Promise<void> {
    try {
      const result = await this.client.getConversations()
      this.sessions = result.conversations || []
      this.filteredSessions = [...this.sessions]
    } catch {
      this.sessions = []
      this.filteredSessions = []
    }
  }

  private getSessionTitle(session: Conversation): string {
    if (session.title) return session.title
    
    // Use first user message as title
    const firstUserMsg = session.messages.find(m => m.role === 'user')
    if (firstUserMsg) {
      const content = firstUserMsg.content
      return content.length > 50 ? content.substring(0, 47) + '...' : content
    }
    
    return 'Untitled conversation'
  }

  private getSessionAge(session: Conversation): string {
    const updated = new Date(session.updatedAt)
    const now = new Date()
    const diffMs = now.getTime() - updated.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  private resumeSession(id: string): void {
    this.state.currentConversationId = id
    // Note: We'd need a callback to switch views - for now just set the ID
  }

  // Set callback for switching to chat view
  setSwitchToChatCallback(callback: (conversationId?: string) => Promise<void>): void {
    this.onSwitchToChat = callback
  }

  // Handle keyboard shortcuts
  handleKeyPress(key: KeyEvent): void {
    // If in rename mode, let the input handle it
    if (this.renameMode) {
      if (key.name === 'escape') {
        this.renameMode = false
        this.renameInput = null
        this.refresh()
      }
      return
    }

    // If in search mode, let the input handle most keys
    if (this.searchMode && key.name !== 'escape') {
      return
    }

    switch (key.name) {
      case 'up':
        this.navigateUp()
        break
      case 'down':
        this.navigateDown()
        break
      case 'enter':
        this.resumeSelectedSession()
        break
      case 'n':
        this.handleNewConversation()
        break
      case 'd':
        this.deleteSelectedSession()
        break
      case 'r':
        this.renameSelectedSession()
        break
      case 'e':
        this.renameSelectedSession()
        break
      case 'escape':
        if (this.searchMode) {
          this.exitSearchMode()
        }
        break
    }

    // Character-based shortcuts (key.name is undefined for non-letter keys like '/')
    const ch = typeof key.sequence === 'string' ? key.sequence : ''
    if (ch === '/') {
      this.enterSearchMode()
    }
  }

  private navigateUp(): void {
    if (this.filteredSessions.length === 0) return
    this.selectedIndex = Math.max(0, this.selectedIndex - 1)
    if (this.selectList) {
      this.selectList.setSelectedIndex(this.selectedIndex)
    }
  }

  private navigateDown(): void {
    if (this.filteredSessions.length === 0) return
    this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + 1)
    if (this.selectList) {
      this.selectList.setSelectedIndex(this.selectedIndex)
    }
  }

  private resumeSelectedSession(): void {
    const session = this.filteredSessions[this.selectedIndex]
    if (session) {
      this.resumeSession(session.id)
      if (this.onSwitchToChat) {
        this.onSwitchToChat(session.id)
      }
    }
  }

  private handleNewConversation(): void {
    this.state.currentConversationId = undefined
    if (this.onSwitchToChat) {
      this.onSwitchToChat()
    }
  }

  private async deleteSelectedSession(): Promise<void> {
    const session = this.filteredSessions[this.selectedIndex]
    if (!session) return

    try {
      await this.client.deleteConversation(session.id)
      // Reload sessions
      await this.loadSessions()
      this.filterSessions()
      await this.refresh()
    } catch {
      // Ignore errors
    }
  }

  private renameMode: boolean = false
  private renameInput: InputRenderable | null = null
  private statusText: TextRenderable | null = null

  private enterSearchMode(): void {
    this.searchMode = true
    this.searchQuery = ''
    this.refresh()
  }

  private exitSearchMode(): void {
    this.searchMode = false
    this.searchQuery = ''
    this.searchInput = null
    this.filterSessions()
    this.refresh()
  }

  private filterSessions(): void {
    if (!this.searchQuery) {
      this.filteredSessions = [...this.sessions]
    } else {
      const query = this.searchQuery.toLowerCase()
      this.filteredSessions = this.sessions.filter(s => {
        const title = this.getSessionTitle(s).toLowerCase()
        return title.includes(query)
      })
    }
    this.selectedIndex = 0
  }

  private async refreshList(): Promise<void> {
    // Soft refresh: recreate the view without reloading sessions from network.
    // A full this.refresh() → hide() → show() → loadSessions() is too heavy
    // for real-time search filtering — it makes a network call on every keystroke.
    if (!this.isVisible) return
    if (this.viewContainer) {
      this.container.remove(this.viewContainer.id)
      this.viewContainer = null
    }
    this.isVisible = false  // Allow createContent to proceed
    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)
    this.isVisible = true
  }

  private async renameSelectedSession(): Promise<void> {
    const displaySessions = this.searchMode ? this.filteredSessions : this.sessions
    const session = displaySessions[this.selectedIndex]
    if (!session) return

    // Simple inline rename: prompt in the status area
    this.renameMode = true
    const currentTitle = this.getSessionTitle(session)

    // For simplicity, we'll use a basic approach: show an input
    // Create a temporary input for rename
    if (!this.viewContainer) return

    const renameBar = new BoxRenderable(this.renderer, {
      id: 'rename-bar',
      width: '100%',
      height: 1,
      flexDirection: 'row',
      backgroundColor: '#2a2a1a',
    })

    const renameLabel = new TextRenderable(this.renderer, {
      id: 'rename-label',
      content: ' Rename: ',
      fg: '#FFAA66',
      height: 1,
    })
    renameBar.add(renameLabel)

    this.renameInput = new InputRenderable(this.renderer, {
      id: 'rename-input',
      width: 40,
      height: 1,
      placeholder: currentTitle,
      focusedBackgroundColor: '#2a2a2a',
    })
    this.renameInput.value = currentTitle
    this.renameInput.on(InputRenderableEvents.ENTER, async () => {
      if (this.renameInput) {
        const newTitle = this.renameInput.value.trim()
        if (newTitle && newTitle !== currentTitle) {
          try {
            await this.client.updateConversation(session.id, { title: newTitle })
            await this.loadSessions()
            this.filterSessions()
          } catch {
            // Ignore errors
          }
        }
      }
      this.renameMode = false
      this.renameInput = null
      await this.refresh()
    })
    renameBar.add(this.renameInput)
    this.viewContainer.add(renameBar)
    this.renameInput.focus()
  }
}
