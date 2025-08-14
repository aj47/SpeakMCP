import { screen } from "electron"
import { configStore } from "./config"

export type PanelPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "custom"

export interface PanelSize {
  width: number
  height: number
}

export interface Position {
  x: number
  y: number
}

const PANEL_MARGIN = 10

/**
 * Calculate panel position based on the configured position setting
 */
export function calculatePanelPosition(
  size: PanelSize,
  _mode: "normal" | "agent" | "textInput" = "normal",
): Position {
  const config = configStore.get()
  const position = config.panelPosition || "top-right"

  // If custom position is set and we have custom coordinates, use them
  if (position === "custom" && config.panelCustomPosition) {
    return config.panelCustomPosition
  }

  // Get the screen where the cursor is currently located
  const currentScreen = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  )
  const screenSize = currentScreen.workArea

  return calculatePositionForPreset(position, screenSize, size)
}

/**
 * Calculate position for a specific preset position
 */
export function calculatePositionForPreset(
  position: PanelPosition,
  screenSize: { x: number; y: number; width: number; height: number },
  size: PanelSize,
): Position {
  const margin = PANEL_MARGIN

  switch (position) {
    case "top-left":
      return {
        x: screenSize.x + margin,
        y: screenSize.y + margin,
      }

    case "top-center":
      return {
        x: Math.floor(screenSize.x + (screenSize.width - size.width) / 2),
        y: screenSize.y + margin,
      }

    case "top-right":
      return {
        x: Math.floor(screenSize.x + (screenSize.width - size.width) - margin),
        y: screenSize.y + margin,
      }

    case "bottom-left":
      return {
        x: screenSize.x + margin,
        y: Math.floor(
          screenSize.y + (screenSize.height - size.height) - margin,
        ),
      }

    case "bottom-center":
      return {
        x: Math.floor(screenSize.x + (screenSize.width - size.width) / 2),
        y: Math.floor(
          screenSize.y + (screenSize.height - size.height) - margin,
        ),
      }

    case "bottom-right":
      return {
        x: Math.floor(screenSize.x + (screenSize.width - size.width) - margin),
        y: Math.floor(
          screenSize.y + (screenSize.height - size.height) - margin,
        ),
      }

    case "custom":
    default:
      // Fallback to top-right if custom position is not available
      return {
        x: Math.floor(screenSize.x + (screenSize.width - size.width) - margin),
        y: screenSize.y + margin,
      }
  }
}

/**
 * Save custom position to config
 */
export function saveCustomPosition(position: Position): void {
  const config = configStore.get()
  configStore.save({
    ...config,
    panelPosition: "custom",
    panelCustomPosition: position,
  })
}

/**
 * Update panel position setting
 */
export function updatePanelPosition(position: PanelPosition): void {
  const config = configStore.get()
  configStore.save({
    ...config,
    panelPosition: position,
  })
}

/**
 * Check if position is within screen bounds and adjust if necessary
 */
export function constrainPositionToScreen(
  position: Position,
  size: PanelSize,
  screenSize?: { x: number; y: number; width: number; height: number },
): Position {
  if (!screenSize) {
    const currentScreen = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    )
    screenSize = currentScreen.workArea
  }

  const constrainedPosition = { ...position }

  // Ensure the panel doesn't go off the left or right edge
  constrainedPosition.x = Math.max(
    screenSize.x,
    Math.min(
      constrainedPosition.x,
      screenSize.x + screenSize.width - size.width,
    ),
  )

  // Ensure the panel doesn't go off the top or bottom edge
  constrainedPosition.y = Math.max(
    screenSize.y,
    Math.min(
      constrainedPosition.y,
      screenSize.y + screenSize.height - size.height,
    ),
  )

  return constrainedPosition
}
