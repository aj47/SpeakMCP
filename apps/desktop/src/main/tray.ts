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
    {
      label: state.isRecording ? "Cancel Recording" : "Start Recording",
      click() {
        if (state.isRecording) {
          state.isRecording = false
          tray.setImage(defaultIcon)
          stopRecordingAndHidePanelWindow()
          return
        }
        state.isRecording = true
        tray.setImage(stopIcon)
        showPanelWindowAndStartRecording(true)
      },
    },
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
