/**
 * Tools View - Browse and execute MCP tools
 */

import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
} from '@opentui/core'

import { BaseView } from './base'
import type { McpTool, McpServer } from '../types'

interface ToolsByServer {
  server: McpServer
  tools: McpTool[]
}

interface FlatTool {
  serverName: string
  tool: McpTool
}

export class ToolsView extends BaseView {
  private toolsByServer: ToolsByServer[] = []
  private flatTools: FlatTool[] = []
  private selectedToolIndex: number = 0
  private toolElements: Map<number, TextRenderable> = new Map()
  private resultBox: BoxRenderable | null = null
  private resultText: TextRenderable | null = null
  private argInputMode: boolean = false
  private argInput: InputRenderable | null = null
  private statusText: TextRenderable | null = null

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    // Load tools
    await this.loadTools()

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)
  }

  hide(): void {
    this.toolElements.clear()
    this.resultBox = null
    this.resultText = null
    this.argInput = null
    this.statusText = null
    super.hide()
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
      content: ' MCP Tools                       [Enter] Execute  [Up/Dn] Navigate',
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

    this.toolElements.clear()
    let flatIndex = 0

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

        const statusIcon = server.status === 'connected' ? 'v' : '>'
        const statusLabel = server.status === 'connected' ? 'connected' : server.status
        const serverTitle = new TextRenderable(this.renderer, {
          id: `server-title-${server.name}`,
          content: `${statusIcon} ${server.name} (${server.transport}) -- ${statusLabel}`,
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
          for (const tool of tools) {
            const desc = tool.description
              ? tool.description.substring(0, 40) + (tool.description.length > 40 ? '...' : '')
              : ''
            const isSelected = flatIndex === this.selectedToolIndex
            const prefix = isSelected ? '> ' : '  '
            const toolText = new TextRenderable(this.renderer, {
              id: `tool-${server.name}-${tool.name}`,
              content: `${prefix}|- ${tool.name.padEnd(25)} ${desc}`,
              fg: isSelected ? '#FFFFFF' : '#AAAAFF',
            })
            serverBox.add(toolText)
            this.toolElements.set(flatIndex, toolText)
            flatIndex++
          }
        }

        contentContainer.add(serverBox)
      }
    }

    view.add(contentContainer)

    // Result display area
    this.resultBox = new BoxRenderable(this.renderer, {
      id: 'tool-result-box',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      height: 6,
    })

    this.resultText = new TextRenderable(this.renderer, {
      id: 'tool-result-text',
      content: 'Select a tool and press [Enter] to execute',
      fg: '#888888',
    })
    this.resultBox.add(this.resultText)
    view.add(this.resultBox)

    // Footer
    const footer = new BoxRenderable(this.renderer, {
      id: 'tools-footer',
      width: '100%',
      height: 1,
      backgroundColor: '#333333',
    })
    const footerText = new TextRenderable(this.renderer, {
      id: 'tools-footer-text',
      content: ' [Enter] Execute  [Up/Dn] Navigate  [R]estart  [S]top  [L]ogs  [T]est  [Esc] Cancel',
      fg: '#AAAAAA',
    })
    footer.add(footerText)
    view.add(footer)

    return view
  }

  // Keyboard handler
  handleKeyPress(key: KeyEvent): void {
    if (this.argInputMode) {
      if (key.name === 'escape') {
        this.argInputMode = false
        this.argInput = null
        this.setResult('Execution cancelled', '#888888')
        this.refresh()
      }
      // Input handles other keys
      return
    }

    switch (key.name) {
      case 'up':
        this.selectPrevTool()
        break
      case 'down':
        this.selectNextTool()
        break
      case 'enter':
        this.executeSelectedTool()
        break
    }

    // Character-based shortcuts for server management
    const ch = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : ''
    switch (ch) {
      case 'r':
        this.restartSelectedServer()
        break
      case 's':
        this.stopSelectedServer()
        break
      case 'l':
        this.showSelectedServerLogs()
        break
      case 't':
        this.testSelectedServer()
        break
    }
  }

  private selectNextTool(): void {
    if (this.flatTools.length === 0) return
    this.unhighlightTool(this.selectedToolIndex)
    this.selectedToolIndex = (this.selectedToolIndex + 1) % this.flatTools.length
    this.highlightTool(this.selectedToolIndex)
  }

  private selectPrevTool(): void {
    if (this.flatTools.length === 0) return
    this.unhighlightTool(this.selectedToolIndex)
    this.selectedToolIndex = (this.selectedToolIndex - 1 + this.flatTools.length) % this.flatTools.length
    this.highlightTool(this.selectedToolIndex)
  }

  private highlightTool(index: number): void {
    const el = this.toolElements.get(index)
    const flat = this.flatTools[index]
    if (!el || !flat) return
    const desc = flat.tool.description
      ? flat.tool.description.substring(0, 40) + (flat.tool.description.length > 40 ? '...' : '')
      : ''
    el.content = `> |- ${flat.tool.name.padEnd(25)} ${desc}`
    el.fg = '#FFFFFF'
  }

  private unhighlightTool(index: number): void {
    const el = this.toolElements.get(index)
    const flat = this.flatTools[index]
    if (!el || !flat) return
    const desc = flat.tool.description
      ? flat.tool.description.substring(0, 40) + (flat.tool.description.length > 40 ? '...' : '')
      : ''
    el.content = `  |- ${flat.tool.name.padEnd(25)} ${desc}`
    el.fg = '#AAAAFF'
  }

  private async executeSelectedTool(): Promise<void> {
    const flat = this.flatTools[this.selectedToolIndex]
    if (!flat) return

    const tool = flat.tool

    // Check if tool has required arguments
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined
    const hasRequiredArgs = schema?.required && schema.required.length > 0
    const hasProperties = schema?.properties && Object.keys(schema.properties).length > 0

    if (hasRequiredArgs || hasProperties) {
      // Show args input
      this.promptForArgs(tool)
    } else {
      // Execute directly with empty args
      await this.runTool(tool.name, {})
    }
  }

  private promptForArgs(tool: McpTool): void {
    this.argInputMode = true
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined
    const params = schema?.properties ? Object.keys(schema.properties) : []
    const hint = params.length > 0 ? `Params: ${params.join(', ')}` : 'Enter JSON arguments'

    this.setResult(`${tool.name}\n${hint}\nEnter args as JSON (or {} for none):`, '#FFAA66')

    if (!this.resultBox) return

    this.argInput = new InputRenderable(this.renderer, {
      id: 'tool-args-input',
      width: 60,
      height: 1,
      placeholder: '{}',
      focusedBackgroundColor: '#2a2a2a',
    })
    this.argInput.value = '{}'
    this.argInput.on(InputRenderableEvents.ENTER, async () => {
      if (!this.argInput) return
      const argsStr = this.argInput.value.trim() || '{}'
      this.argInputMode = false
      this.argInput = null

      try {
        const args = JSON.parse(argsStr)
        await this.runTool(tool.name, args)
      } catch {
        this.setResult(`X Invalid JSON: ${argsStr}`, '#FF6666')
      }
      this.refresh()
    })
    this.resultBox.add(this.argInput)
    this.argInput.focus()
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<void> {
    this.setResult(`~ Executing ${name}...`, '#FFAA66')

    try {
      const result = await this.client.callMcpTool(name, args)
      const resultStr = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2)
      const truncated = resultStr.length > 500 ? resultStr.substring(0, 497) + '...' : resultStr
      this.setResult(`+ ${name} result:\n${truncated}`, '#88FF88')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setResult(`X ${name} failed:\n${msg}`, '#FF6666')
    }
  }

  private setResult(text: string, color: string): void {
    if (this.resultText) {
      this.resultText.content = text
      this.resultText.fg = color
    }
  }

  private getSelectedServerName(): string | null {
    const flat = this.flatTools[this.selectedToolIndex]
    return flat ? flat.serverName : (this.toolsByServer[0]?.server.name || null)
  }

  private async restartSelectedServer(): Promise<void> {
    const serverName = this.getSelectedServerName()
    if (!serverName) return
    this.setResult(`~ Restarting ${serverName}...`, '#FFAA66')
    try {
      const result = await this.client.restartMcpServer(serverName)
      if (result.success) {
        this.setResult(`+ ${serverName} restarted successfully`, '#88FF88')
        setTimeout(() => this.refresh(), 500)
      } else {
        this.setResult(`X Restart failed: ${result.error}`, '#FF6666')
      }
    } catch (err) {
      this.setResult(`X Restart error: ${err instanceof Error ? err.message : String(err)}`, '#FF6666')
    }
  }

  private async stopSelectedServer(): Promise<void> {
    const serverName = this.getSelectedServerName()
    if (!serverName) return
    this.setResult(`~ Stopping ${serverName}...`, '#FFAA66')
    try {
      const result = await this.client.stopMcpServer(serverName)
      if (result.success) {
        this.setResult(`+ ${serverName} stopped`, '#88FF88')
        setTimeout(() => this.refresh(), 500)
      } else {
        this.setResult(`X Stop failed: ${result.error}`, '#FF6666')
      }
    } catch (err) {
      this.setResult(`X Stop error: ${err instanceof Error ? err.message : String(err)}`, '#FF6666')
    }
  }

  private async showSelectedServerLogs(): Promise<void> {
    const serverName = this.getSelectedServerName()
    if (!serverName) return
    this.setResult(`~ Fetching logs for ${serverName}...`, '#FFAA66')
    try {
      const result = await this.client.getMcpServerLogs(serverName)
      const logs = result.logs || []
      if (logs.length === 0) {
        this.setResult(`${serverName}: No logs available`, '#888888')
      } else {
        const last10 = logs.slice(-10).join('\n')
        this.setResult(`${serverName} logs (last ${Math.min(logs.length, 10)}):\n${last10}`, '#AAAAFF')
      }
    } catch (err) {
      this.setResult(`X Logs error: ${err instanceof Error ? err.message : String(err)}`, '#FF6666')
    }
  }

  private async testSelectedServer(): Promise<void> {
    const serverName = this.getSelectedServerName()
    if (!serverName) return
    this.setResult(`~ Testing connection to ${serverName}...`, '#FFAA66')
    try {
      const result = await this.client.testMcpServer(serverName)
      if (result.success) {
        this.setResult(`+ ${serverName}: Connection OK, ${result.toolCount || 0} tools`, '#88FF88')
      } else {
        this.setResult(`X ${serverName}: Test failed - ${result.error}`, '#FF6666')
      }
    } catch (err) {
      this.setResult(`X Test error: ${err instanceof Error ? err.message : String(err)}`, '#FF6666')
    }
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

      // Build flat index for navigation
      this.flatTools = []
      for (const { server, tools: serverTools } of this.toolsByServer) {
        for (const tool of serverTools) {
          this.flatTools.push({ serverName: server.name, tool })
        }
      }
    } catch {
      this.toolsByServer = []
      this.flatTools = []
    }
  }
}

