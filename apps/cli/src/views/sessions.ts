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

    // Focus the select list
    if (this.selectList) {
      this.selectList.focus()
    }
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
      content: ' 📋 Sessions                         [/] Search  [N] New',
      fg: '#FFFFFF',
    })
    header.add(headerText)
    view.add(header)

    // Sessions list
    const listContainer = new BoxRenderable(this.renderer, {
      id: 'sessions-list-container',
      flexGrow: 1,
      width: '100%',
      padding: 1,
    })

    if (this.sessions.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'no-sessions',
        content: 'No conversations yet. Press [N] or switch to Chat to start one.',
        fg: '#888888',
      })
      listContainer.add(emptyText)
    } else {
      const options = this.sessions.map(s => ({
        name: this.getSessionTitle(s),
        description: this.getSessionAge(s),
      }))

      this.selectList = new SelectRenderable(this.renderer, {
        id: 'sessions-list',
        width: '100%',
        height: Math.min(this.sessions.length * 2 + 2, 20),
        options,
      })

      this.selectList.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
        const session = this.sessions[index]
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
      content: ' [Enter] Resume  [D] Delete  [N] New session',
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
    // If in search mode, let the input handle it
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
      case '/':
        this.enterSearchMode()
        break
      case 'escape':
        if (this.searchMode) {
          this.exitSearchMode()
        }
        break
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

  private enterSearchMode(): void {
    this.searchMode = true
    // Would need to add search input to the view and focus it
    // For now, this is a placeholder
  }

  private exitSearchMode(): void {
    this.searchMode = false
    this.searchQuery = ''
    this.filterSessions()
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
}

