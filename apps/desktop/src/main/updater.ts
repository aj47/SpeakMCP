import electronUpdater, { UpdateInfo } from "electron-updater"
import { MenuItem, dialog } from "electron"
import { makePanelWindowClosable, WINDOWS } from "./window"
import { getRendererHandlers } from "@egoist/tipc/main"
import { RendererHandlers } from "./renderer-handlers"

electronUpdater.autoUpdater.fullChangelog = true
electronUpdater.autoUpdater.autoDownload = false
electronUpdater.autoUpdater.autoInstallOnAppQuit = true

// Uncomment the following line to test auto-updates in development
// electronUpdater.autoUpdater.forceDevUpdateConfig = import.meta.env.DEV

if (import.meta.env.PROD) {
  electronUpdater.autoUpdater.setFeedURL({
    provider: "github",
    host: "electron-releases.umida.co",
    owner: "aj47",
    repo: "SpeakMCP",
  })
}

let updateInfo: UpdateInfo | null = null
let downloadedUpdates: string[] | null = null
let menuItem: MenuItem | null = null

function enableMenuItem() {
  if (menuItem) {
    menuItem.enabled = true
    menuItem = null
  }
}

export function init() {
  electronUpdater.autoUpdater.addListener("update-downloaded", (e) => {
    const window = WINDOWS.get("main")
    if (window) {
      getRendererHandlers<RendererHandlers>(
        window.webContents,
      ).updateAvailable.send(e)
    }
    // Menu.setApplicationMenu(createAppMenu('downloaded'))
  })

  electronUpdater.autoUpdater.addListener("update-not-available", () => {
    updateInfo = null
    enableMenuItem()
    // const window = windows.get('updater')
    // window?.close()
  })

  let hasSetDownloaing = false
  electronUpdater.autoUpdater.addListener("download-progress", (_info) => {
    // const window = windows.get('updater')
    // if (window) {
    //   window.webContents.send('download-progress', info)
    // }

    if (!hasSetDownloaing) {
      hasSetDownloaing = true
      // Menu.setApplicationMenu(createAppMenu('downloading'))
    }
  })
}

export function getUpdateInfo() {
  return updateInfo
}

export async function checkForUpdatesMenuItem(_menuItem: MenuItem) {
  menuItem = _menuItem
  menuItem.enabled = false

  const checkResult = await checkForUpdatesAndDownload().catch(() => null)

  if (checkResult && checkResult.updateInfo) {
    // nothing
  } else {
    await dialog.showMessageBox({
      title: "No updates available",
      message: `You are already using the latest version of ${process.env.PRODUCT_NAME}.`,
    })
  }
}

export async function checkForUpdatesAndDownload() {
  if (updateInfo && downloadedUpdates) return { downloadedUpdates, updateInfo }
  if (updateInfo) return { updateInfo, downloadedUpdates }

  const updates = await electronUpdater.autoUpdater.checkForUpdates()

  if (
    updates &&
    electronUpdater.autoUpdater.currentVersion.compare(
      updates.updateInfo.version,
    ) === -1
  ) {
    updateInfo = updates.updateInfo
    downloadedUpdates = await downloadUpdate()
    return { updateInfo, downloadedUpdates }
  }

  updateInfo = null
  downloadedUpdates = null
  return { updateInfo, downloadedUpdates }
}

export function quitAndInstall() {
  makePanelWindowClosable()
  setTimeout(() => {
    electronUpdater.autoUpdater.quitAndInstall()
  })
}

let cancellationToken: electronUpdater.CancellationToken | null = null

export async function downloadUpdate() {
  if (cancellationToken) {
    return null
  }

  cancellationToken = new electronUpdater.CancellationToken()
  const result =
    await electronUpdater.autoUpdater.downloadUpdate(cancellationToken)
  cancellationToken = null
  return result
}

export function cancelDownloadUpdate() {
  if (cancellationToken) {
    cancellationToken.cancel()
    cancellationToken = null
  }
}
