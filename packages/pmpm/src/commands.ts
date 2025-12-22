/**
 * PMPM Commands - dev, build, install
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getProjectPaths, isValidProject, type ProjectPaths } from './paths.js';
import { ensureRustBinary, buildRustBinary, getRustStatus } from './rust.js';
import { logger } from './logger.js';

/**
 * Run a command with inherited stdio
 */
function runCommand(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: 'inherit' });
}

/**
 * Run a command with spawned process (for dev server)
 */
function spawnCommand(command: string, args: string[], cwd: string): void {
  const proc = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  proc.on('error', (err) => {
    logger.error(`Failed to start process: ${err.message}`);
    process.exit(1);
  });

  proc.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

/**
 * Build the shared package
 */
function buildShared(paths: ProjectPaths): void {
  if (existsSync(paths.sharedPackage)) {
    logger.step('Building shared package...');
    runCommand('pnpm build', paths.sharedPackage);
  }
}

/**
 * pmpm dev - Run development server with Rust binary check
 */
export function devCommand(args: string[]): void {
  const paths = getProjectPaths();

  if (!isValidProject(paths)) {
    logger.error('Not in a valid SpeakMCP project directory');
    process.exit(1);
  }

  logger.header('PMPM Dev');

  // Build shared package first
  buildShared(paths);

  // Ensure Rust binary exists
  if (!ensureRustBinary(paths)) {
    logger.error('Failed to ensure Rust binary exists');
    process.exit(1);
  }

  logger.newline();
  logger.step('Starting development server...');
  logger.command(`pnpm --filter @speakmcp/desktop dev ${args.join(' ')}`);
  logger.newline();

  // Pass any additional arguments to the dev command
  const devArgs = ['--filter', '@speakmcp/desktop', 'dev', ...args];
  spawnCommand('pnpm', devArgs, paths.root);
}

/**
 * pmpm build - Build with Rust binary included
 */
export function buildCommand(args: string[]): void {
  const paths = getProjectPaths();

  if (!isValidProject(paths)) {
    logger.error('Not in a valid SpeakMCP project directory');
    process.exit(1);
  }

  logger.header('PMPM Build');

  // Build shared package first
  buildShared(paths);

  // Build Rust binary
  if (!buildRustBinary(paths)) {
    logger.error('Failed to build Rust binary');
    process.exit(1);
  }

  logger.newline();
  logger.step('Building desktop application...');

  // Determine build target from args
  const buildArgs = args.length > 0 ? args : [];
  const filterArgs = ['--filter', '@speakmcp/desktop', 'build', ...buildArgs];

  logger.command(`pnpm ${filterArgs.join(' ')}`);
  logger.newline();

  spawnCommand('pnpm', filterArgs, paths.root);
}

/**
 * pmpm install - Install dependencies with Rust binary setup
 */
export function installCommand(args: string[]): void {
  const paths = getProjectPaths();

  if (!isValidProject(paths)) {
    logger.error('Not in a valid SpeakMCP project directory');
    process.exit(1);
  }

  logger.header('PMPM Install');

  // Run pnpm install
  logger.step('Installing dependencies...');
  logger.command('pnpm install');
  runCommand('pnpm install', paths.root);

  // Build shared package
  buildShared(paths);

  // Ensure Rust binary exists
  logger.newline();
  if (!ensureRustBinary(paths)) {
    logger.warn('Failed to build Rust binary automatically');
    logger.info('You can build it manually with: pnpm build-rs');
  }

  logger.newline();
  logger.success('Installation complete!');
  logger.info('Run "pmpm dev" to start the development server');
}

/**
 * pmpm status - Show current status
 */
export function statusCommand(): void {
  const paths = getProjectPaths();

  if (!isValidProject(paths)) {
    logger.error('Not in a valid SpeakMCP project directory');
    process.exit(1);
  }

  logger.header('PMPM Status');

  const rustStatus = getRustStatus(paths);

  logger.info(`Project root: ${paths.root}`);
  logger.info(`Rust binary path: ${rustStatus.binaryPath}`);
  logger.info(`Cargo installed: ${rustStatus.cargoInstalled ? 'Yes' : 'No'}`);
  logger.info(`Rust binary exists: ${rustStatus.binaryExists ? 'Yes' : 'No'}`);
}

