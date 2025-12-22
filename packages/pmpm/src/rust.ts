/**
 * Rust binary management utilities
 */

import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { detectPlatform, getPlatformDescription } from './platform.js';
import { getProjectPaths, type ProjectPaths } from './paths.js';
import { logger } from './logger.js';

export interface RustStatus {
  binaryExists: boolean;
  cargoInstalled: boolean;
  binaryPath: string;
}

/**
 * Check if Cargo (Rust) is installed
 */
export function isCargoInstalled(): boolean {
  try {
    const result = spawnSync('cargo', ['--version'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get the Rust binary status
 */
export function getRustStatus(paths?: ProjectPaths): RustStatus {
  const projectPaths = paths ?? getProjectPaths();

  return {
    binaryExists: existsSync(projectPaths.binaryPath),
    cargoInstalled: isCargoInstalled(),
    binaryPath: projectPaths.binaryPath,
  };
}

/**
 * Build the Rust binary
 */
export function buildRustBinary(paths?: ProjectPaths): boolean {
  const projectPaths = paths ?? getProjectPaths();
  const platformInfo = detectPlatform();

  logger.header('Building Rust Binary');
  logger.info(`Platform: ${getPlatformDescription(platformInfo)}`);

  // Check if Cargo is installed
  if (!isCargoInstalled()) {
    logger.error('Cargo (Rust) is not installed.');
    logger.info('Please install Rust from https://rustup.rs/');
    return false;
  }

  // Ensure resources/bin directory exists
  if (!existsSync(projectPaths.resourcesBin)) {
    mkdirSync(projectPaths.resourcesBin, { recursive: true });
    logger.step(`Created directory: ${projectPaths.resourcesBin}`);
  }

  // Build with cargo
  logger.step('Running cargo build --release...');
  try {
    execSync('cargo build --release', {
      cwd: projectPaths.rustProject,
      stdio: 'inherit',
    });
  } catch (error) {
    logger.error('Cargo build failed');
    return false;
  }

  // Copy binary to resources/bin
  const srcBinary = join(
    projectPaths.rustProject,
    'target',
    'release',
    platformInfo.binaryName
  );

  if (!existsSync(srcBinary)) {
    logger.error(`Built binary not found at: ${srcBinary}`);
    return false;
  }

  copyFileSync(srcBinary, projectPaths.binaryPath);
  logger.step(`Copied binary to: ${projectPaths.binaryPath}`);

  // Make executable on Unix
  if (!platformInfo.isWindows) {
    chmodSync(projectPaths.binaryPath, 0o755);
  }

  // Sign on macOS if script exists
  if (platformInfo.isMac) {
    const signScript = join(projectPaths.desktopApp, 'scripts', 'sign-binary.sh');
    if (existsSync(signScript)) {
      logger.step('Signing binary for macOS...');
      try {
        execSync(`sh ${signScript}`, {
          cwd: projectPaths.desktopApp,
          stdio: 'inherit',
        });
      } catch {
        logger.warn('Binary signing failed (this may be okay for local dev)');
      }
    }
  }

  logger.success('Rust binary built successfully!');
  return true;
}

/**
 * Ensure the Rust binary exists, building if necessary
 */
export function ensureRustBinary(paths?: ProjectPaths): boolean {
  const projectPaths = paths ?? getProjectPaths();
  const status = getRustStatus(projectPaths);

  if (status.binaryExists) {
    logger.success(`Rust binary found at: ${status.binaryPath}`);
    return true;
  }

  logger.warn('Rust binary not found, building...');
  return buildRustBinary(projectPaths);
}

