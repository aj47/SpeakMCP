import { MeetingTranscriptionPanel } from "@renderer/components/meeting-transcription-panel"

export function Component() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold mb-2">Meeting Transcription</h1>
          <p className="text-muted-foreground mb-6">
            Record and transcribe meetings by capturing both your microphone and system audio.
            This allows you to transcribe what you say and what other meeting participants say.
          </p>
          
          <div className="bg-card rounded-lg border p-6">
            <MeetingTranscriptionPanel />
          </div>

          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <h3 className="font-semibold mb-2">How it works</h3>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>• <strong>Microphone:</strong> Captures your voice</li>
              <li>• <strong>System Audio:</strong> Captures audio from other meeting participants (Zoom, Meet, Teams, etc.)</li>
              <li>• Both audio streams are mixed and sent to your configured transcription provider</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <h3 className="font-semibold text-yellow-600 dark:text-yellow-400 mb-2">macOS Requirements</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Requires macOS 12.3 (Monterey) or later</li>
              <li>• Screen recording permission is required for system audio capture</li>
              <li>• You'll be prompted to select a screen/window when starting (audio only is captured)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

