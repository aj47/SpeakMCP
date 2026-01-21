/**
 * Chat View - Primary chat interface with streaming responses
 */

import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
} from '@opentui/core'

import { BaseView } from './base'
import type { ChatMessage, ConversationMessage } from '../types'

export class ChatView extends BaseView {
  private messageContainer: BoxRenderable | null = null
  private inputField: InputRenderable | null = null
  private messages: ConversationMessage[] = []
  private streamingContent: string = ''
  private streamingText: TextRenderable | null = null

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)

    // Focus the input field
    if (this.inputField) {
      this.inputField.focus()
    }

    // Load existing conversation if we have an ID
    if (this.state.currentConversationId) {
      await this.loadConversation()
    }
  }

  protected async createContent(): Promise<BoxRenderable> {
    const view = new BoxRenderable(this.renderer, {
      id: 'chat-view',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })

    // Header
    const header = new BoxRenderable(this.renderer, {
      id: 'chat-header',
      width: '100%',
      height: 1,
      backgroundColor: '#1a1a2e',
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'chat-header-text',
      content: ' 💬 Chat                                      [Ctrl+N] New',
      fg: '#FFFFFF',
    })
    header.add(headerText)
    view.add(header)

    // Message area
    this.messageContainer = new BoxRenderable(this.renderer, {
      id: 'message-container',
      flexDirection: 'column',
      flexGrow: 1,
      width: '100%',
      padding: 1,
      overflow: 'scroll',
    })
    view.add(this.messageContainer)

    // Render existing messages
    this.renderMessages()

    // Input area at bottom
    const inputContainer = new BoxRenderable(this.renderer, {
      id: 'input-container',
      width: '100%',
      height: 3,
      borderStyle: 'single',
      borderColor: '#444444',
    })
    
    this.inputField = new InputRenderable(this.renderer, {
      id: 'chat-input',
      width: '100%',
      height: 1,
      placeholder: 'Type your message... [Enter] Send',
      focusedBackgroundColor: '#1a1a1a',
    })

    this.inputField.on(InputRenderableEvents.CHANGE, async (value: string) => {
      if (value.trim()) {
        await this.sendMessage(value.trim())
        if (this.inputField) {
          this.inputField.value = ''
        }
      }
    })

    inputContainer.add(this.inputField)
    view.add(inputContainer)

    return view
  }

  private renderMessages(): void {
    if (!this.messageContainer) return

    // Clear existing messages
    const children = this.messageContainer.getChildren()
    for (const child of children) {
      this.messageContainer.remove(child.id)
    }

    for (const msg of this.messages) {
      const isUser = msg.role === 'user'
      const messageBox = new BoxRenderable(this.renderer, {
        id: `msg-${Date.now()}-${Math.random()}`,
        width: '100%',
        borderStyle: 'single',
        borderColor: isUser ? '#4a4a4a' : '#2a4a6a',
        marginBottom: 1,
        padding: 1,
      })

      const roleText = new TextRenderable(this.renderer, {
        id: `role-${Date.now()}-${Math.random()}`,
        content: `─ ${isUser ? 'User' : 'Assistant'} ─`,
        fg: isUser ? '#888888' : '#6688AA',
      })
      messageBox.add(roleText)

      const contentText = new TextRenderable(this.renderer, {
        id: `content-${Date.now()}-${Math.random()}`,
        content: msg.content,
        fg: '#FFFFFF',
      })
      messageBox.add(contentText)

      // Show tool calls if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          const toolText = new TextRenderable(this.renderer, {
            id: `tool-${Date.now()}-${Math.random()}`,
            content: `🔧 Using: ${tc.name}`,
            fg: '#AAAAFF',
          })
          messageBox.add(toolText)
        }
      }

      this.messageContainer.add(messageBox)
    }
  }

  private async loadConversation(): Promise<void> {
    if (!this.state.currentConversationId) return
    
    try {
      const conv = await this.client.getConversation(this.state.currentConversationId)
      this.messages = conv.messages
      this.renderMessages()
    } catch {
      // Ignore - conversation may not exist
    }
  }

  private async sendMessage(content: string): Promise<void> {
    // Add user message to display
    this.messages.push({ role: 'user', content })
    this.renderMessages()

    // Prepare messages for API
    const chatMessages: ChatMessage[] = this.messages.map(m => ({
      role: m.role === 'tool' ? 'assistant' : m.role,
      content: m.content,
    }))

    // Create streaming placeholder
    this.streamingContent = ''
    this.addStreamingMessage()

    try {
      this.state.isProcessing = true

      // Stream the response - handling typed SSE events
      for await (const event of this.client.chatStream(chatMessages, this.state.currentConversationId)) {
        switch (event.type) {
          case 'chunk': {
            const delta = event.data.choices[0]?.delta?.content
            if (delta) {
              this.streamingContent += delta
              this.updateStreamingMessage()
            }
            break
          }
          case 'progress': {
            // Progress events contain agent iteration info - could display tool calls, etc.
            // For now, just show streaming content if present
            const streamData = event.data as { streamingContent?: { text: string } }
            if (streamData.streamingContent?.text) {
              this.streamingContent = streamData.streamingContent.text
              this.updateStreamingMessage()
            }
            break
          }
          case 'done': {
            // Final content from done event
            if (event.data.content) {
              this.streamingContent = event.data.content
            }
            break
          }
          // error events are thrown as exceptions and caught below
        }
      }

      // Finalize message
      this.messages.push({ role: 'assistant', content: this.streamingContent })
      this.streamingContent = ''
      this.streamingText = null
      this.renderMessages()

    } catch (err) {
      // Show error
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      this.messages.push({
        role: 'assistant',
        content: `❌ Error: ${errorMsg}`
      })
      this.renderMessages()
    } finally {
      this.state.isProcessing = false
    }
  }

  private addStreamingMessage(): void {
    if (!this.messageContainer) return

    const streamBox = new BoxRenderable(this.renderer, {
      id: 'streaming-msg',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#2a6a4a',
      marginBottom: 1,
      padding: 1,
    })

    const roleText = new TextRenderable(this.renderer, {
      id: 'streaming-role',
      content: '─ Assistant ─ (streaming...)',
      fg: '#66AA88',
    })
    streamBox.add(roleText)

    this.streamingText = new TextRenderable(this.renderer, {
      id: 'streaming-content',
      content: '▌',
      fg: '#FFFFFF',
    })
    streamBox.add(this.streamingText)

    this.messageContainer.add(streamBox)
  }

  private updateStreamingMessage(): void {
    if (this.streamingText) {
      this.streamingText.content = this.streamingContent + '▌'
    }
  }

  async newConversation(): Promise<void> {
    this.messages = []
    this.state.currentConversationId = undefined
    this.renderMessages()
    if (this.inputField) {
      this.inputField.focus()
    }
  }
}

