/**
 * Settings View - View and modify configuration
 */

import {
  BoxRenderable,
  TextRenderable,
} from '@opentui/core'

import { BaseView } from './base'
import type { Settings, McpServer } from '../types'

export class SettingsView extends BaseView {
  private settings: Settings | null = null
  private mcpServers: McpServer[] = []

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    // Load settings and MCP servers
    await this.loadData()

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)
  }

  protected async createContent(): Promise<BoxRenderable> {
    const view = new BoxRenderable(this.renderer, {
      id: 'settings-view',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })

    // Header
    const header = new BoxRenderable(this.renderer, {
      id: 'settings-header',
      width: '100%',
      height: 1,
      backgroundColor: '#2e2e1a',
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'settings-header-text',
      content: ' ⚙️  Settings',
      fg: '#FFFFFF',
    })
    header.add(headerText)
    view.add(header)

    // Content area
    const contentContainer = new BoxRenderable(this.renderer, {
      id: 'settings-content',
      flexDirection: 'column',
      flexGrow: 1,
      width: '100%',
      padding: 1,
    })

    // LLM Settings Section
    const llmSection = new BoxRenderable(this.renderer, {
      id: 'llm-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const llmTitle = new TextRenderable(this.renderer, {
      id: 'llm-title',
      content: '─ LLM Configuration ─',
      fg: '#AAAAAA',
    })
    llmSection.add(llmTitle)

    if (this.settings) {
      const provider = new TextRenderable(this.renderer, {
        id: 'provider-text',
        content: `  Provider:        ${this.settings.mcpToolsProviderId || 'openai'}`,
        fg: '#FFFFFF',
      })
      llmSection.add(provider)

      const model = new TextRenderable(this.renderer, {
        id: 'model-text',
        content: `  Model:           ${this.getActiveModel()}`,
        fg: '#FFFFFF',
      })
      llmSection.add(model)

      const maxIter = new TextRenderable(this.renderer, {
        id: 'max-iter-text',
        content: `  Max Iterations:  ${this.settings.mcpMaxIterations || 10}`,
        fg: '#FFFFFF',
      })
      llmSection.add(maxIter)
    } else {
      const loading = new TextRenderable(this.renderer, {
        id: 'settings-loading',
        content: '  Loading settings...',
        fg: '#888888',
      })
      llmSection.add(loading)
    }

    contentContainer.add(llmSection)

    // MCP Servers Section
    const mcpSection = new BoxRenderable(this.renderer, {
      id: 'mcp-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
    })

    const mcpTitle = new TextRenderable(this.renderer, {
      id: 'mcp-title',
      content: '─ MCP Servers ─',
      fg: '#AAAAAA',
    })
    mcpSection.add(mcpTitle)

    if (this.mcpServers.length === 0) {
      const noServers = new TextRenderable(this.renderer, {
        id: 'no-servers',
        content: '  No MCP servers configured',
        fg: '#888888',
      })
      mcpSection.add(noServers)
    } else {
      for (const server of this.mcpServers) {
        const icon = server.status === 'connected' ? '✓' : '✗'
        const color = server.status === 'connected' ? '#88FF88' : '#FF8888'
        const serverText = new TextRenderable(this.renderer, {
          id: `server-${server.name}`,
          content: `  ${icon} ${server.name.padEnd(20)} ${server.toolCount} tools    ${server.transport}`,
          fg: color,
        })
        mcpSection.add(serverText)
      }
    }

    contentContainer.add(mcpSection)
    view.add(contentContainer)

    return view
  }

  private async loadData(): Promise<void> {
    try {
      const [settings, serversResult] = await Promise.all([
        this.client.getSettings(),
        this.client.getMcpServers(),
      ])
      this.settings = settings
      this.mcpServers = serversResult.servers || []
    } catch {
      // Ignore errors
    }
  }

  private getActiveModel(): string {
    if (!this.settings) return 'unknown'
    const provider = this.settings.mcpToolsProviderId || 'openai'
    switch (provider) {
      case 'openai':
        return this.settings.mcpToolsOpenaiModel || 'gpt-4o-mini'
      case 'groq':
        return this.settings.mcpToolsGroqModel || 'llama-3.3-70b-versatile'
      case 'gemini':
        return this.settings.mcpToolsGeminiModel || 'gemini-2.0-flash-exp'
      default:
        return 'unknown'
    }
  }
}

