/**
 * Path utilities for the pmpm CLI
 */

import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { detectPlatform } from './platform.js';

export interface ProjectPaths {
  root: string;
  desktopApp: string;
  rustProject: string;
  resourcesBin: string;
  binaryPath: string;
  sharedPackage: string;
}

/**
 * Find the project root directory by looking for package.json with workspaces
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (currentDir !== dirname(currentDir)) {
    const packageJsonPath = join(currentDir, 'package.json');
    const pnpmWorkspacePath = join(currentDir, 'pnpm-workspace.yaml');

    if (existsSync(packageJsonPath) && existsSync(pnpmWorkspacePath)) {
      return currentDir;
    }

    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Get all project paths
 */
export function getProjectPaths(rootDir?: string): ProjectPaths {
  const root = rootDir ?? findProjectRoot() ?? process.cwd();
  const desktopApp = join(root, 'apps', 'desktop');
  const rustProject = join(desktopApp, 'speakmcp-rs');
  const resourcesBin = join(desktopApp, 'resources', 'bin');
  const { binaryName } = detectPlatform();
  const binaryPath = join(resourcesBin, binaryName);
  const sharedPackage = join(root, 'packages', 'shared');

  return {
    root,
    desktopApp,
    rustProject,
    resourcesBin,
    binaryPath,
    sharedPackage,
  };
}

/**
 * Check if we're in a valid SpeakMCP project
 */
export function isValidProject(paths: ProjectPaths): boolean {
  return (
    existsSync(join(paths.root, 'package.json')) &&
    existsSync(join(paths.root, 'pnpm-workspace.yaml')) &&
    existsSync(paths.desktopApp) &&
    existsSync(paths.rustProject)
  );
}

