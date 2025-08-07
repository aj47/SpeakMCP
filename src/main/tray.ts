import { Menu, Tray } from "electron"
import path from "path"
import {
  getWindowRendererHandlers,
  showMainWindow,
  showPanelWindowAndStartRecording,
  stopRecordingAndHidePanelWindow,
} from "./window"
import { state } from "./state"

const defaultIcon = path.join(
  __dirname,
  `../../resources/${process.env.IS_MAC ? "trayIconTemplate.png" : "trayIcon.ico"}`,
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
        showPanelWindowAndStartRecording()
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
      accelerator: "CmdOrCtrl+,",
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
}

export const initTray = () => {
  const tray = (_tray = new Tray(defaultIcon))

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
