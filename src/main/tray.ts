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
        console.log(
          "[tray] Start/Cancel Recording clicked; isRecording:",
          state.isRecording,
        )
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
      label: state.isDesktopRecordingActive
        ? "Stop Desktop Recording"
        : "Start Desktop Recording",
      click() {
        console.log(
          "[tray] Desktop recording menu clicked; isDesktopRecordingActive:",
          state.isDesktopRecordingActive,
        )
        // Show main window on history route and start/stop desktop recording
        showMainWindow("/history")
        const handlers = getWindowRendererHandlers("main")
        console.log(
          "[tray] getWindowRendererHandlers('main') returned:",
          !!handlers,
        )
        if (!handlers) {
          return
        }
        if (state.isDesktopRecordingActive) {
          handlers.stopDesktopRecording?.send()
        } else {
          handlers.startDesktopRecording?.send()
        }
      },
    },
    {
      label: "View History",
      click() {
        showMainWindow("/history")
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

  const isAnyRecording = state.isRecording || state.isDesktopRecordingActive
  _tray.setImage(isAnyRecording ? stopIcon : defaultIcon)
}

export const initTray = () => {
  const tray = (_tray = new Tray(defaultIcon))

  tray.on("click", () => {
    console.log(
      "[tray] Tray left-click; isRecording:",
      state.isRecording,
      "isDesktopRecordingActive:",
      state.isDesktopRecordingActive,
    )
    if (state.isRecording) {
      getWindowRendererHandlers("panel")?.finishRecording.send()
      return
    }

    tray.popUpContextMenu(buildMenu(tray))
  })

  tray.on("right-click", () => {
    console.log("[tray] Tray right-click (context menu)")
    tray.popUpContextMenu(buildMenu(tray))
  })
}
