import { spawn, ChildProcess } from "child_process"
import path from "path"
import { state, agentProcessManager } from "../state"
import { keysPressed } from "./keyboard-state"

const rdevPath = path
  .join(
    __dirname,
    `../../../resources/bin/speakmcp-rs${process.platform === "win32" ? ".exe" : ""}`,
  )
  .replace("app.asar", "app.asar.unpacked")

export { rdevPath }

export const writeText = (text: string) => {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["write", text])

    // Register process if agent mode is active
    if (state.isAgentModeActive) {
      agentProcessManager.registerProcess(child)
    }

    let stderr = ""

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn process: ${error.message}`))
    })

    child.on("close", (code) => {
      // writeText will trigger KeyPress event of the key A
      // I don't know why
      keysPressed.clear()

      if (code === 0) {
        resolve()
      } else {
        const errorMessage = `child process exited with code ${code}${stderr.trim() ? `. stderr: ${stderr.trim()}` : ""}`
        reject(new Error(errorMessage))
      }
    })
  })
}

export const getFocusedAppInfo = () => {
  return new Promise<string>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["get-focus"])

    // Register process if agent mode is active
    if (state.isAgentModeActive) {
      agentProcessManager.registerProcess(child)
    }

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn process: ${error.message}`))
    })

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        const errorMessage = `get-focus command failed with code ${code}${stderr.trim() ? `. stderr: ${stderr.trim()}` : ""}`
        reject(new Error(errorMessage))
      }
    })
  })
}

export const restoreFocusToApp = (appInfo: string) => {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["restore-focus", appInfo])

    // Register process if agent mode is active
    if (state.isAgentModeActive) {
      agentProcessManager.registerProcess(child)
    }

    let stderr = ""

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn process: ${error.message}`))
    })

    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        const errorMessage = `restore-focus command failed with code ${code}${stderr.trim() ? `. stderr: ${stderr.trim()}` : ""}`
        reject(new Error(errorMessage))
      }
    })
  })
}

export const captureFocusBeforeRecording = async () => {
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }
}

export const writeTextWithFocusRestore = async (text: string) => {
  const focusedApp = state.focusedAppBeforeRecording

  if (focusedApp) {
    try {
      await restoreFocusToApp(focusedApp)

      // Small delay to ensure focus is restored before pasting
      await new Promise((resolve) => setTimeout(resolve, 100))

      await writeText(text)
    } catch (error) {
      // Fallback to regular paste without focus restoration
      await writeText(text)
    }
  } else {
    await writeText(text)
  }
}
