// This file has been refactored into the keyboard/ module.
// Re-exporting all public APIs for backward compatibility.
export {
  listenToKeyboardEvents,
  writeText,
  getFocusedAppInfo,
  restoreFocusToApp,
  writeTextWithFocusRestore,
} from "./keyboard/index"
