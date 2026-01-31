import { useCallback, useEffect, useState } from "react"
import { tipcClient } from "~/lib/tipc-client"

/**
 * Notch overlay page (macOS only)
 *
 * Renders a small transparent window with a clickable pill indicator
 * positioned under the webcam notch. Clicking opens the latest
 * conversation or a blank session in the main window.
 *
 * The window uses setIgnoreMouseEvents(true, {forward: true}) so
 * transparent regions pass clicks through. We use onMouseEnter/Leave
 * via CSS pointer-events to toggle ignore on/off for the visible pill.
 */
export function Component() {
  const [hovered, setHovered] = useState(false)

  const handleMouseEnter = useCallback(() => {
    // Tell Electron to stop ignoring mouse events so we can receive clicks
    tipcClient.notchSetIgnoreMouse({ ignore: false })
    setHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    // Resume ignoring mouse events on transparent regions
    tipcClient.notchSetIgnoreMouse({ ignore: true })
    setHovered(false)
  }, [])

  const handleClick = useCallback(() => {
    tipcClient.openLatestConversation()
  }, [])

  // On mount, ensure mouse events are ignored (transparent passthrough)
  useEffect(() => {
    tipcClient.notchSetIgnoreMouse({ ignore: true })
  }, [])

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "transparent",
        // Allow clicks to pass through the transparent container
        pointerEvents: "none",
        WebkitAppRegion: "no-drag" as any,
        userSelect: "none",
      }}
    >
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          // Re-enable pointer events on the pill itself
          pointerEvents: "auto",
          cursor: "pointer",
          width: 48,
          height: 6,
          borderRadius: 3,
          marginBottom: 4,
          background: hovered
            ? "rgba(255, 255, 255, 0.55)"
            : "rgba(255, 255, 255, 0.2)",
          transition: "all 0.2s ease",
          transform: hovered ? "scaleX(1.3)" : "scaleX(1)",
          boxShadow: hovered
            ? "0 0 8px rgba(255, 255, 255, 0.3)"
            : "none",
        }}
      />
    </div>
  )
}
