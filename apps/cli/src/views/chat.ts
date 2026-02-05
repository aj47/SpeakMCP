/**
 * Chat View - Primary chat interface with streaming responses
 */

import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
} from '@opentui/core'

import { BaseView } from './base'
import type { ChatMessage, ConversationMessage, AgentProgressUpdate, AgentProgressStep } from '../types'

// Progress tracking state
interface ProgressState {
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  pendingToolApproval?: {
    approvalId: string
    toolName: string
    arguments: unknown
  }
}

export class ChatView extends BaseView {
  private messageContainer: BoxRenderable | null = null
  private inputField: InputRenderable | null = null
  private messages: ConversationMessage[] = []
  private streamingContent: string = ''
  private streamingText: TextRenderable | null = null
  private progressState: ProgressState | null = null
  private progressContainer: BoxRenderable | null = null

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

    // Initialize progress state
    this.streamingContent = ''
    this.progressState = null
    let hasProgressEvents = false

    try {
      this.state.isProcessing = true

      // Stream the response - handling typed SSE events
      for await (const event of this.client.chatStream(chatMessages, this.state.currentConversationId)) {
        switch (event.type) {
          case 'chunk': {
            // If we haven't seen progress events, use simple streaming display
            if (!hasProgressEvents && !this.streamingText) {
              this.addStreamingMessage()
            }
            const delta = event.data.choices[0]?.delta?.content
            if (delta) {
              this.streamingContent += delta
              if (hasProgressEvents) {
                this.updateProgressDisplay()
              } else {
                this.updateStreamingMessage()
              }
            }
            break
          }
          case 'progress': {
            hasProgressEvents = true
            const progressData = event.data as AgentProgressUpdate

            // Initialize progress display on first progress event
            if (!this.progressState) {
              this.removeStreamingMessage()
              this.addProgressDisplay()
            }

            // Update progress state
            this.progressState = {
              currentIteration: progressData.currentIteration,
              maxIterations: progressData.maxIterations,
              steps: progressData.steps,
              pendingToolApproval: progressData.pendingToolApproval,
            }

            // Handle tool approval if pending
            if (progressData.pendingToolApproval) {
              await this.handleToolApproval(progressData.pendingToolApproval)
            }

            // Extract streaming content from the latest streaming step
            const streamingStep = progressData.steps.find(s => s.type === 'streaming')
            if (streamingStep?.streamContent) {
              this.streamingContent = streamingStep.streamContent
            }

            this.updateProgressDisplay()
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

      // Remove progress display and finalize message
      if (hasProgressEvents) {
        this.removeProgressDisplay()
      }
      this.messages.push({ role: 'assistant', content: this.streamingContent })
      this.streamingContent = ''
      this.streamingText = null
      this.renderMessages()

    } catch (err) {
      // Clean up progress display on error
      if (hasProgressEvents) {
        this.removeProgressDisplay()
      }
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

  private removeStreamingMessage(): void {
    if (!this.messageContainer) return
    this.messageContainer.remove('streaming-msg')
    this.streamingText = null
  }

  private addProgressDisplay(): void {
    if (!this.messageContainer) return

    // Create or get progress container
    this.progressContainer = new BoxRenderable(this.renderer, {
      id: 'progress-container',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#4a4a8a',
      marginBottom: 1,
      padding: 1,
      flexDirection: 'column',
    })

    const headerText = new TextRenderable(this.renderer, {
      id: 'progress-header',
      content: '─ Assistant ─ (processing...)',
      fg: '#8888CC',
    })
    this.progressContainer.add(headerText)

    this.messageContainer.add(this.progressContainer)
  }

  private updateProgressDisplay(): void {
    if (!this.progressContainer || !this.progressState) return

    // Clear existing progress content (keep header)
    const children = this.progressContainer.getChildren()
    for (const child of children) {
      if (child.id !== 'progress-header') {
        this.progressContainer.remove(child.id)
      }
    }

    const { currentIteration, maxIterations, steps } = this.progressState

    // Iteration counter
    const iterText = new TextRenderable(this.renderer, {
      id: 'progress-iteration',
      content: `⏳ Iteration ${currentIteration}/${maxIterations}`,
      fg: '#AAAAFF',
    })
    this.progressContainer.add(iterText)

    // Render each step
    for (const step of steps) {
      const stepContent = this.formatProgressStep(step)
      const stepText = new TextRenderable(this.renderer, {
        id: `step-${step.id}`,
        content: stepContent,
        fg: this.getStepColor(step),
      })
      this.progressContainer.add(stepText)
    }

    // Show streaming content if available
    if (this.streamingContent) {
      const contentText = new TextRenderable(this.renderer, {
        id: 'progress-content',
        content: this.streamingContent + '▌',
        fg: '#FFFFFF',
      })
      this.progressContainer.add(contentText)
    }
  }

  private formatProgressStep(step: AgentProgressStep): string {
    const icon = this.getStepIcon(step)

    switch (step.type) {
      case 'thinking':
        return `${icon} ${step.title}`

      case 'tool_call': {
        const toolName = step.toolName || 'tool'
        const args = step.toolInput
          ? ` ${this.truncateArgs(step.toolInput)}`
          : ''
        return `${icon} ${toolName}${args}`
      }

      case 'tool_result': {
        const result = step.toolOutput
          ? ` → ${this.truncate(step.toolOutput, 60)}`
          : ''
        return `${icon} Result${result}`
      }

      case 'tool_processing': {
        const toolName = step.toolName || 'tool'
        return `${icon} Processing ${toolName}...`
      }

      case 'error':
        return `${icon} Error: ${step.description || step.title}`

      case 'retry':
        return `${icon} Retry #${step.retryCount || 1}: ${step.retryReason || step.title}`

      case 'context_reduction':
        return `${icon} Reducing context: ${step.description || step.title}`

      case 'verification':
        return `${icon} Verifying: ${step.description || step.title}`

      case 'acp_delegation':
        return `${icon} Delegating to agent: ${step.description || step.title}`

      case 'streaming':
        return `${icon} ${step.title}`

      case 'completion':
        return `${icon} ${step.title}`

      default:
        return `${icon} ${step.title}`
    }
  }

  private getStepIcon(step: AgentProgressStep): string {
    switch (step.type) {
      case 'thinking':
        return '💭'

      case 'tool_call':
        if (step.status === 'running') return '▶'
        if (step.status === 'complete') return '✓'
        if (step.status === 'error') return '❌'
        return '⏳'

      case 'tool_result':
        return step.isError ? '❌' : '✅'

      case 'tool_processing':
        return '⚙️'

      case 'error':
        return '❌'

      case 'retry':
        return '🔄'

      case 'context_reduction':
        return '📦'

      case 'verification':
        return '🔍'

      case 'acp_delegation':
        return '🤖'

      case 'streaming':
        return '📡'

      case 'completion':
        return '✅'

      default:
        return '•'
    }
  }

  private getStepColor(step: AgentProgressStep): string {
    if (step.status === 'error' || step.isError) return '#FF6666'
    if (step.status === 'running') return '#FFAA66'
    if (step.status === 'complete') return '#66FF88'
    if (step.type === 'thinking') return '#AAAAFF'
    if (step.type === 'tool_call') return '#FFCC66'
    if (step.type === 'tool_result') return '#88CCFF'
    if (step.type === 'tool_processing') return '#FFAA66'
    if (step.type === 'context_reduction') return '#CC88FF'
    if (step.type === 'verification') return '#88FFCC'
    if (step.type === 'acp_delegation') return '#FF88CC'
    if (step.type === 'streaming') return '#88AAFF'
    return '#CCCCCC'
  }

  private async handleToolApproval(approval: { approvalId: string; toolName: string; arguments: unknown }): Promise<void> {
    if (!this.progressContainer) return

    // Show approval prompt in the progress display
    const approvalBox = new BoxRenderable(this.renderer, {
      id: 'tool-approval-prompt',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#FFAA00',
      padding: 1,
    })

    const promptText = new TextRenderable(this.renderer, {
      id: 'approval-prompt-text',
      content: `⚠️  Tool approval required: ${approval.toolName}`,
      fg: '#FFAA00',
    })
    approvalBox.add(promptText)

    const argsText = new TextRenderable(this.renderer, {
      id: 'approval-args-text',
      content: `   Args: ${this.truncateArgs(approval.arguments)}`,
      fg: '#CCCCCC',
    })
    approvalBox.add(argsText)

    const hintText = new TextRenderable(this.renderer, {
      id: 'approval-hint-text',
      content: '   Press [Y] Approve  [N] Deny',
      fg: '#FFFFFF',
    })
    approvalBox.add(hintText)

    this.progressContainer.add(approvalBox)

    // Store the pending approval for keyboard handling
    this.pendingApprovalId = approval.approvalId
  }

  private pendingApprovalId: string | null = null

  private async respondToToolApproval(approved: boolean): Promise<void> {
    if (!this.pendingApprovalId) return

    try {
      await this.client.respondToToolApproval(this.pendingApprovalId, approved)
    } catch {
      // Ignore errors - the agent will time out if needed
    }
    this.pendingApprovalId = null

    // Remove the approval prompt
    if (this.progressContainer) {
      this.progressContainer.remove('tool-approval-prompt')
    }
  }

  private truncateArgs(args: unknown): string {
    try {
      const str = typeof args === 'string' ? args : JSON.stringify(args)
      return this.truncate(str, 50)
    } catch {
      return ''
    }
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    return str.slice(0, maxLen - 3) + '...'
  }

  private removeProgressDisplay(): void {
    if (!this.messageContainer || !this.progressContainer) return
    this.messageContainer.remove('progress-container')
    this.progressContainer = null
    this.progressState = null
  }

  async newConversation(): Promise<void> {
    this.messages = []
    this.state.currentConversationId = undefined
    this.renderMessages()
    if (this.inputField) {
      this.inputField.focus()
    }
  }

  // Handle keyboard shortcuts
  handleKeyPress(key: KeyEvent): void {
    if (!this.messageContainer) return

    // Handle tool approval Y/N
    if (this.pendingApprovalId) {
      if (key.name === 'y') {
        this.respondToToolApproval(true)
        return
      } else if (key.name === 'n') {
        this.respondToToolApproval(false)
        return
      }
    }

    switch (key.name) {
      case 'up':
        // Scroll up
        this.scrollMessages(-1)
        break
      case 'down':
        // Scroll down
        this.scrollMessages(1)
        break
      case 'pageup':
        // Scroll up by page
        this.scrollMessages(-10)
        break
      case 'pagedown':
        // Scroll down by page
        this.scrollMessages(10)
        break
    }
  }

  private scrollMessages(lines: number): void {
    if (!this.messageContainer) return
    // The message container has overflow: 'scroll', so we can scroll it
    // OpenTUI handles scroll internally, but we can try to trigger scroll
    // by adjusting scroll offset if the container supports it
    // For now, the container should auto-scroll with overflow: 'scroll'
    // This is a placeholder for future scroll implementation
  }
}

