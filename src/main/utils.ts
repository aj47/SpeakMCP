import { systemPreferences } from "electron"

export const isAccessibilityGranted = () => {
  if (process.platform === "win32") return true

  // On Linux, always return true for development
  if (process.platform === "linux") return true

  return systemPreferences.isTrustedAccessibilityClient(false)
}
