// @ts-check
import { execSync } from "child_process"

/**
 *
 * @param {string} command
 * @param {{cwd?: string}} options
 * @returns
 */
const run = (command, { cwd } = {}) => {
  return execSync(command, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
    },
  })
}

const desktopDir = process.cwd()

run(`rm -rf dist`, { cwd: desktopDir })

run(`pnpm build-rs`)

if (process.platform === "darwin") {
  run(`pnpm build:mac --arm64 --publish always`, {
    cwd: desktopDir,
  })
} else {
  run(`pnpm build:win --publish always`, {
    cwd: desktopDir,
  })
}
