#!/usr/bin/env node
/**
 * Cross-platform postinstall script for electron-builder install-app-deps
 * 
 * On Windows, electron-builder attempts to execute pnpm.cjs directly instead
 * of using pnpm.cmd, which causes "not a valid Win32 application" errors.
 * 
 * This script works around the issue by:
 * - On Windows: Using npx to invoke electron-builder which properly handles
 *   the package manager execution
 * - On other platforms: Running electron-builder install-app-deps directly
 * 
 * Issue: https://github.com/aj47/SpeakMCP/issues/581
 */

const { spawn } = require('child_process');
const os = require('os');

const isWindows = os.platform() === 'win32';

console.log(`[postinstall] Running on ${os.platform()} (${os.arch()})`);

/**
 * Execute a command with proper error handling
 * @param {string} command - The command to execute
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
function execCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`[postinstall] Executing: ${command} ${args.join(' ')}`);
    
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: isWindows, // Use shell on Windows to resolve .cmd files
      cwd: process.cwd(),
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    // Use npx on all platforms to find electron-builder from node_modules
    // On Windows, this also avoids the issue where electron-builder tries
    // to execute pnpm.cjs directly instead of pnpm.cmd
    if (isWindows) {
      console.log('[postinstall] Windows detected, using npx with shell...');
    }
    await execCommand('npx', ['electron-builder', 'install-app-deps']);

    console.log('[postinstall] Native dependencies installed successfully!');
  } catch (error) {
    console.error('[postinstall] Failed to install native dependencies:', error.message);
    console.error('');
    console.error('[postinstall] You can try the manual workaround:');
    console.error('  1. Run: pnpm install --ignore-scripts');
    if (isWindows) {
      console.error('  2. Run: pnpm.cmd exec electron-builder install-app-deps');
    } else {
      console.error('  2. Run: npx electron-builder install-app-deps');
    }
    console.error('');
    // Exit with error code to signal failure
    process.exit(1);
  }
}

main();

