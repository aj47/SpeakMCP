import { MenuItem, dialog } from "electron"

/**
 * Auto-updater is disabled - updates are manual via GitHub releases.
 * This prevents 403 errors from the invalid update server (electron-releases.umida.co).
 */

export function init() {
  // Auto-updater is disabled - no initialization needed
}

export function getUpdateInfo() {
  return null
}

export async function checkForUpdatesMenuItem(_menuItem: MenuItem) {
  // Auto-updater is disabled - show message directing to GitHub releases
  await dialog.showMessageBox({
    title: "Check for Updates",
    message: `To check for updates, please visit:\nhttps://github.com/aj47/SpeakMCP/releases`,
  })
}

export async function checkForUpdatesAndDownload() {
  // Auto-updater is disabled - always return null
  return { updateInfo: null, downloadedUpdates: null }
}

export function quitAndInstall() {
  // No-op - auto-updater is disabled
}

export async function downloadUpdate() {
  // No-op - auto-updater is disabled
  return null
}

export function cancelDownloadUpdate() {
  // No-op - auto-updater is disabled
}
