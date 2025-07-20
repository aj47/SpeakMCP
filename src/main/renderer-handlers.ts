import { UpdateDownloadedEvent } from "electron-updater"
import { AgentChainProgressUpdate } from "./agent-chain-service"

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

  // Agent Chain handlers
  startAgentChainRecording: () => void
  finishAgentChainRecording: () => void
  startOrFinishAgentChainRecording: () => void
  agentChainProgress: (update: AgentChainProgressUpdate) => void

  updateAvailable: (e: UpdateDownloadedEvent) => void
  navigate: (url: string) => void
}
