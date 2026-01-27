/**
 * Tools View - Browse available MCP tools
 */

import {
  BoxRenderable,
  TextRenderable,
} from '@opentui/core'

import { BaseView } from './base'
import type { McpTool, McpServer } from '../types'

interface ToolsByServer {
  server: McpServer
  tools: McpTool[]
}

export class ToolsView extends BaseView {
  private toolsByServer: ToolsByServer[] = []

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    // Load tools
    await this.loadTools()

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)
  }

  protected async createContent(): Promise<BoxRenderable> {
    const view = new BoxRenderable(this.renderer, {
      id: 'tools-view',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })

    // Header
    const header = new BoxRenderable(this.renderer, {
      id: 'tools-header',
      width: '100%',
      height: 1,
      backgroundColor: '#2e1a2e',
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'tools-header-text',
      content: ' 🔧 MCP Tools',
      fg: '#FFFFFF',
    })
    header.add(headerText)
    view.add(header)

    // Content area
    const contentContainer = new BoxRenderable(this.renderer, {
      id: 'tools-content',
      flexDirection: 'column',
      flexGrow: 1,
      width: '100%',
      padding: 1,
      overflow: 'scroll',
    })

    if (this.toolsByServer.length === 0) {
      const noTools = new TextRenderable(this.renderer, {
        id: 'no-tools',
        content: 'No MCP tools available. Check your MCP server configuration.',
        fg: '#888888',
      })
      contentContainer.add(noTools)
    } else {
      for (const { server, tools } of this.toolsByServer) {
        // Server header
        const serverBox = new BoxRenderable(this.renderer, {
          id: `server-box-${server.name}`,
          width: '100%',
          borderStyle: 'single',
          borderColor: server.status === 'connected' ? '#4a6a4a' : '#6a4a4a',
          padding: 1,
          marginBottom: 1,
        })

        const statusIcon = server.status === 'connected' ? '▼' : '▷'
        const statusText = server.status === 'connected' ? 'connected' : server.status
        const serverTitle = new TextRenderable(this.renderer, {
          id: `server-title-${server.name}`,
          content: `${statusIcon} ${server.name} (${server.transport}) ─ ${statusText}`,
          fg: server.status === 'connected' ? '#88AA88' : '#AA8888',
        })
        serverBox.add(serverTitle)

        // Tools list
        if (tools.length === 0) {
          const noServerTools = new TextRenderable(this.renderer, {
            id: `no-tools-${server.name}`,
            content: '  No tools available',
            fg: '#666666',
          })
          serverBox.add(noServerTools)
        } else {
          for (const tool of tools.slice(0, 10)) { // Limit to first 10 tools per server
            const desc = tool.description 
              ? tool.description.substring(0, 40) + (tool.description.length > 40 ? '...' : '')
              : ''
            const toolText = new TextRenderable(this.renderer, {
              id: `tool-${server.name}-${tool.name}`,
              content: `  ├─ ${tool.name.padEnd(25)} ${desc}`,
              fg: '#AAAAFF',
            })
            serverBox.add(toolText)
          }
          
          if (tools.length > 10) {
            const moreText = new TextRenderable(this.renderer, {
              id: `more-tools-${server.name}`,
              content: `  └─ ... and ${tools.length - 10} more tools`,
              fg: '#666666',
            })
            serverBox.add(moreText)
          }
        }

        contentContainer.add(serverBox)
      }
    }

    view.add(contentContainer)

    return view
  }

  private async loadTools(): Promise<void> {
    try {
      const [serversResult, toolsResult] = await Promise.all([
        this.client.getMcpServers(),
        this.client.listMcpTools(),
      ])

      const servers = serversResult.servers || []
      const tools = toolsResult.tools || []

      // Group tools by server
      this.toolsByServer = servers.map(server => ({
        server,
        tools: tools.filter(t => t.serverName === server.name),
      }))
    } catch {
      this.toolsByServer = []
    }
  }
}

