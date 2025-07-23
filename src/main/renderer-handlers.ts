import { UpdateDownloadedEvent } from "electron-updater"
import { AgentProgressUpdate } from "../shared/types"

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

  // Agent Mode Progress handlers
  agentProgressUpdate: (update: AgentProgressUpdate) => void
  clearAgentProgress: () => void

  updateAvailable: (e: UpdateDownloadedEvent) => void
  navigate: (url: string) => void
}
