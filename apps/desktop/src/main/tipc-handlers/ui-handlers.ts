import { tipc } from "@egoist/tipc/main"
import { clipboard, Menu, systemPreferences, dialog } from "electron"
import {
  showPanelWindow,
  showMainWindow,
  WINDOWS,
  showPanelWindowAndShowTextInput,
  showPanelWindowAndStartMcpRecording,
} from "../window"
import { isAccessibilityGranted } from "../utils"

const t = tipc.create()

export const uiHandlers = {
  showContextMenu: t.procedure
    .input<{
      x: number
      y: number
      selectedText?: string
      messageContext?: {
        content: string
        role: "user" | "assistant" | "tool"
        messageId: string
      }
    }>()
    .action(async ({ input, context }) => {
      const items: Electron.MenuItemConstructorOptions[] = []

      if (input.selectedText) {
        items.push({
          label: "Copy",
          click() {
            clipboard.writeText(input.selectedText || "")
          },
        })
      }

      // Add message-specific context menu items
      if (input.messageContext) {
        const { content, role } = input.messageContext

        // Add "Copy Message" option for all message types
        items.push({
          label: "Copy Message",
          click() {
            clipboard.writeText(content)
          },
        })

        // Add separator if we have other items
        if (items.length > 0) {
          items.push({ type: "separator" })
        }
      }

      if (import.meta.env.DEV) {
        items.push({
          label: "Inspect Element",
          click() {
            context.sender.inspectElement(input.x, input.y)
          },
        })
      }

      const panelWindow = WINDOWS.get("panel")
      const isPanelWindow = panelWindow?.webContents.id === context.sender.id

      if (isPanelWindow) {
        items.push({
          label: "Close",
          click() {
            panelWindow?.hide()
          },
        })
      }

      const menu = Menu.buildFromTemplate(items)
      menu.popup({
        x: input.x,
        y: input.y,
      })
    }),

  getMicrophoneStatus: t.procedure.action(async () => {
    return systemPreferences.getMediaAccessStatus("microphone")
  }),

  isAccessibilityGranted: t.procedure.action(async () => {
    return isAccessibilityGranted()
  }),

  requestAccesssbilityAccess: t.procedure.action(async () => {
    if (process.platform === "win32") return true

    return systemPreferences.isTrustedAccessibilityClient(true)
  }),

  requestMicrophoneAccess: t.procedure.action(async () => {
    return systemPreferences.askForMediaAccess("microphone")
  }),

  showPanelWindow: t.procedure.action(async () => {
    showPanelWindow()
  }),

  showPanelWindowWithTextInput: t.procedure.action(async () => {
    await showPanelWindowAndShowTextInput()
  }),

  triggerMcpRecording: t.procedure
    .input<{ conversationId?: string; sessionId?: string; fromTile?: boolean }>()
    .action(async ({ input }) => {
      // Always show the panel during recording for waveform feedback
      // The fromTile flag tells the panel to hide after recording ends
      // fromButtonClick=true indicates this was triggered via UI button (not keyboard shortcut)
      await showPanelWindowAndStartMcpRecording(input.conversationId, input.sessionId, input.fromTile, true)
    }),

  showMainWindow: t.procedure
    .input<{ url?: string }>()
    .action(async ({ input }) => {
      showMainWindow(input.url)
    }),

  displayError: t.procedure
    .input<{ title?: string; message: string }>()
    .action(async ({ input }) => {
      dialog.showErrorBox(input.title || "Error", input.message)
    }),

  // Cloudflare Tunnel handlers
  checkCloudflaredInstalled: t.procedure.action(async () => {
    const { checkCloudflaredInstalled } = await import("../cloudflare-tunnel")
    return checkCloudflaredInstalled()
  }),

  startCloudflareTunnel: t.procedure.action(async () => {
    const { startCloudflareTunnel } = await import("../cloudflare-tunnel")
    return startCloudflareTunnel()
  }),

  stopCloudflareTunnel: t.procedure.action(async () => {
    const { stopCloudflareTunnel } = await import("../cloudflare-tunnel")
    return stopCloudflareTunnel()
  }),

  getCloudflareTunnelStatus: t.procedure.action(async () => {
    const { getCloudflareTunnelStatus } = await import("../cloudflare-tunnel")
    return getCloudflareTunnelStatus()
  }),

  // MCP Elicitation handlers (Protocol 2025-11-25)
  resolveElicitation: t.procedure
    .input<{
      requestId: string
      action: "accept" | "decline" | "cancel"
      content?: Record<string, string | number | boolean | string[]>
    }>()
    .action(async ({ input }) => {
      const { resolveElicitation } = await import("../mcp-elicitation")
      return resolveElicitation(input.requestId, {
        action: input.action,
        content: input.content,
      })
    }),

  // MCP Sampling handlers (Protocol 2025-11-25)
  resolveSampling: t.procedure
    .input<{
      requestId: string
      approved: boolean
    }>()
    .action(async ({ input }) => {
      const { resolveSampling } = await import("../mcp-sampling")
      return resolveSampling(input.requestId, input.approved)
    }),
}
