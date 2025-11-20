import { rendererHandlers, tipcClient } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect, useRef, useState } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { SettingsDragBar } from "@renderer/components/settings-drag-bar"
import { ActiveAgentsSidebar } from "@renderer/components/active-agents-sidebar"
import { DesktopRecorder } from "@renderer/lib/desktop-recorder"
import { toast } from "sonner"

type NavLink = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()

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

  const desktopRecorderRef = useRef<DesktopRecorder | null>(null)
  const [isDesktopRecording, setIsDesktopRecording] = useState(false)

  // Initialize desktop + mic long recorder once
  useEffect(() => {
    console.log("[AppLayout] DesktopRecorder init effect running")
    if (desktopRecorderRef.current) return

    console.log("[AppLayout] Creating DesktopRecorder instance")
    const recorder = (desktopRecorderRef.current = new DesktopRecorder())

    recorder.on("session-start", () => {
      console.log("[AppLayout] DesktopRecorder session-start")
      setIsDesktopRecording(true)
      tipcClient.desktopRecordEvent({ type: "start" }).catch((error: any) => {
        console.error(
          "[DesktopRecorder] Failed to notify main of desktop recording start",
          error,
        )
      })
    })



    recorder.on("session-end", async () => {
      console.log("[AppLayout] DesktopRecorder session-end")
      setIsDesktopRecording(false)
      try {
        await tipcClient.desktopRecordEvent({ type: "end" })
      } catch (error: any) {
        console.error(
          "[DesktopRecorder] Failed to notify main of desktop recording end",
          error,
        )
      }
    })

    recorder.on("error", (error) => {
      console.error(
        "[DesktopRecorder] Error",
        error?.name || "",
        error?.message || "",
        error,
      )
      toast.error(
        error?.message || "Desktop recording failed. Screen capture may not be supported in this environment.",
        error?.name ? { description: `Error type: ${error.name}` } : undefined,
      )
      setIsDesktopRecording(false)
      tipcClient.desktopRecordEvent({ type: "end" }).catch(() => {
        // best-effort only
      })
    })
  }, [])

  // Listen for start/stop events triggered from the tray/menu
  useEffect(() => {
    console.log("[AppLayout] Subscribing to startDesktopRecording handler")
    const unlisten = rendererHandlers.startDesktopRecording.listen(async () => {
      console.log("[AppLayout] startDesktopRecording event received")
      try {
        await desktopRecorderRef.current?.start()
      } catch (error) {
        console.error("[DesktopRecorder] Failed to start from tray", error)
      }
    })

    return () => {
      console.log("[AppLayout] Unsubscribing from startDesktopRecording handler")
      unlisten()
    }
  }, [])

  useEffect(() => {
    console.log("[AppLayout] Subscribing to stopDesktopRecording handler")
    const unlisten = rendererHandlers.stopDesktopRecording.listen(() => {
      console.log("[AppLayout] stopDesktopRecording event received")
      desktopRecorderRef.current?.stop()
    })

    return () => {
      console.log("[AppLayout] Unsubscribing from stopDesktopRecording handler")
      unlisten()
    }
  }, [])

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  return (
    <div className="flex h-dvh">
      <div className="flex w-44 shrink-0 flex-col border-r bg-background">
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

        {/* Active Agents Section */}
        <div className="mt-4">
          <ActiveAgentsSidebar />
        </div>

        {/* Loading spinner at the bottom of the sidebar */}
        <div className="flex flex-1 flex-col justify-end">
          <div className="flex flex-col items-center space-y-2 pb-4">
            <LoadingSpinner size="lg" />
            <div>SpeakMCP</div>
            <div className="text-xs">{process.env.APP_VERSION}</div>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 grow flex-col bg-background">
        {/* Draggable top bar for Mac - allows window dragging while content scrolls */}
        {process.env.IS_MAC && <SettingsDragBar />}

        {/* Desktop recording banner */}
        {isDesktopRecording && (
          <div className="flex items-center justify-between border-b border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:border-orange-900/50 dark:bg-orange-900/30 dark:text-orange-200">
            <span className="flex items-center gap-2">
              <span className="i-mingcute-record-fill text-red-500" />
              <span>Desktop recording in progress...</span>
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs font-medium hover:bg-orange-100 dark:hover:bg-orange-800"
              onClick={() => desktopRecorderRef.current?.stop()}
            >
              Stop
            </button>
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
