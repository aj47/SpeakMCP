import { Menu, Tray } from "electron"
import path from "path"
import {
  getWindowRendererHandlers,
  showMainWindow,
  showPanelWindowAndStartRecording,
  stopRecordingAndHidePanelWindow,
} from "./window"
import { state } from "./state"

// Use PNG for macOS and Linux (Waybar/SNI tray), ICO only for Windows
const defaultIcon = path.join(
  __dirname,
  `../../resources/${process.platform === "win32" ? "trayIcon.ico" : "trayIconTemplate.png"}`,
)
const stopIcon = path.join(
  __dirname,
  "../../resources/stopTrayIconTemplate.png",
)

const buildMenu = (tray: Tray) =>
  Menu.buildFromTemplate([
    // When recording, show both "Finish Recording" (submit) and "Cancel Recording" (discard)
    // When not recording, show "Start Recording"
    ...(state.isRecording
      ? [
          {
            label: "Finish Recording",
            click() {
              // Use finishRecording to submit the recording (same as tray click on macOS/Windows)
              getWindowRendererHandlers("panel")?.finishRecording.send()
            },
          },
          {
            label: "Cancel Recording",
            click() {
              state.isRecording = false
              tray.setImage(defaultIcon)
              // On Linux, refresh the context menu to update the label
              if (process.platform === "linux") {
                updateTrayMenu(tray)
              }
              stopRecordingAndHidePanelWindow()
            },
          },
        ]
      : [
          {
            label: "Start Recording",
            click() {
              state.isRecording = true
              tray.setImage(stopIcon)
              // On Linux, refresh the context menu to update the label
              if (process.platform === "linux") {
                updateTrayMenu(tray)
              }
              showPanelWindowAndStartRecording(true)
            },
          },
        ]),
    {
      label: "View History",
      click() {
        showMainWindow("/")
      },
    },
    {
      type: "separator",
    },
    {
      label: "Settings",
      click() {
        showMainWindow("/settings")
      },
    },
    {
      type: "separator",
    },
    {
      role: "quit",
    },
  ])

let _tray: Tray | undefined

export const updateTrayIcon = () => {
  if (!_tray) return

  _tray.setImage(state.isRecording ? stopIcon : defaultIcon)

  // On Linux, also update the context menu to reflect recording state
  if (process.platform === "linux") {
    updateTrayMenu(_tray)
  }
}

const updateTrayMenu = (tray: Tray) => {
  tray.setContextMenu(buildMenu(tray))
}

export const initTray = () => {
  const tray = (_tray = new Tray(defaultIcon))

  // On Linux/Wayland (SNI tray), click events don't work reliably.
  // We must use setContextMenu() so the menu appears on click.
  if (process.platform === "linux") {
    updateTrayMenu(tray)
  } else {
    // macOS and Windows support click events
    tray.on("click", () => {
      if (state.isRecording) {
        getWindowRendererHandlers("panel")?.finishRecording.send()
        return
      }

      tray.popUpContextMenu(buildMenu(tray))
    })

    tray.on("right-click", () => {
      tray.popUpContextMenu(buildMenu(tray))
    })
  }
}
