import { UpdateDownloadedEvent } from "electron-updater"

export type RendererHandlers = {
  startRecording: () => void
  finishRecording: () => void
  stopRecording: () => void
  startOrFinishRecording: () => void
  refreshRecordingHistory: () => void

  // MCP Tool Calling handlers
  startMcpRecording: () => void
  finishMcpRecording: () => void
  startOrFinishMcpRecording: () => void

  // Agent Chaining handlers
  startAgentRecording: () => void
  finishAgentRecording: () => void
  startOrFinishAgentRecording: () => void

  updateAvailable: (e: UpdateDownloadedEvent) => void
  navigate: (url: string) => void
}
