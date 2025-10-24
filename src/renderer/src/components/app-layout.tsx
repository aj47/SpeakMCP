import { rendererHandlers, tipcClient } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect, useState } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { Button } from "@renderer/components/ui/button"
import { useTTSAudio } from "@renderer/contexts/tts-audio-context"

type NavLink = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { stopAllAudio } = useTTSAudio()
  const [isStoppingTTS, setIsStoppingTTS] = useState(false)

  const navLinks: NavLink[] = [
    {
      text: "General",
      href: "/settings",
      icon: "i-mingcute-settings-3-line",
    },
    {
      text: "History",
      href: "/history",
      icon: "i-mingcute-message-3-line",
    },
    {
      text: "Models",
      href: "/settings/models",
      icon: "i-mingcute-brain-line",
    },

    {
      text: "Agents",
      href: "/settings/tools",
      icon: "i-mingcute-android-2-line",
    },
    {
      text: "MCP Tools",
      href: "/settings/mcp-tools",
      icon: "i-mingcute-tool-line",
    },
    {
      text: "Remote Server",
      href: "/settings/remote-server",
      icon: "i-mingcute-server-line",
    },

  ]

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  // Listen for TTS kill switch from main process (ESC key)
  useEffect(() => {
    return rendererHandlers.stopAllTTS.listen(() => {
      console.log("[TTS Kill Switch] ESC key pressed - stopping all TTS audio")
      stopAllAudio()
    })
  }, [stopAllAudio])

  const handleStopTTS = async () => {
    if (isStoppingTTS) return

    setIsStoppingTTS(true)
    try {
      // Stop all TTS audio
      stopAllAudio()

      // Also trigger emergency stop for agent if active
      await tipcClient.emergencyStopAgent()

      console.log("[TTS Kill Switch] Stopped all TTS audio and agent execution")
    } catch (error) {
      console.error("[TTS Kill Switch] Error stopping TTS:", error)
    } finally {
      // Reset button state after a short delay for visual feedback
      setTimeout(() => setIsStoppingTTS(false), 500)
    }
  }

  return (
    <div className="flex h-dvh">
      <div className="app-drag-region flex w-44 shrink-0 flex-col border-r bg-background">
        <header
          className={process.env.IS_MAC ? "h-10" : "h-2"}
          aria-hidden
        ></header>

        <div className="grid gap-0.5 px-2 text-sm">
          {navLinks.map((link) => (
            <NavLink
              key={link.text}
              to={link.href}
              role="button"
              draggable={false}
              className={({ isActive: _isActive }) => {
                // For exact matching, check if the current location exactly matches the link href
                const isExactMatch = location.pathname === link.href
                return cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
                  isExactMatch
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )
              }}
            >
              <span className={link.icon}></span>
              <span className="font-medium">{link.text}</span>
            </NavLink>
          ))}
        </div>

        {/* Stop TTS button and loading spinner at the bottom of the sidebar */}
        <div className="flex flex-1 flex-col justify-end">
          <div className="flex flex-col space-y-3 px-2 pb-4">
            {/* Stop TTS Button */}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopTTS}
              disabled={isStoppingTTS}
              className="w-full transition-all duration-200"
            >
              <span className={cn(
                "mr-2",
                isStoppingTTS ? "i-mingcute-loading-line animate-spin" : "i-mingcute-stop-circle-line"
              )}></span>
              {isStoppingTTS ? "Stopping..." : "Stop TTS"}
            </Button>

            {/* App Info */}
            <div className="flex flex-col items-center space-y-2">
              <LoadingSpinner size="lg" />
              <div>SpeakMCP</div>
              <div className="text-xs">{process.env.APP_VERSION}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex grow flex-col overflow-auto bg-background">
        <Outlet />
      </div>
    </div>
  )
}
