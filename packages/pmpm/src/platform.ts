/**
 * Platform detection and utilities for cross-platform Rust binary management
 */

export type Platform = 'darwin' | 'win32' | 'linux';
export type Arch = 'x64' | 'arm64' | 'ia32';

export interface PlatformInfo {
  platform: Platform;
  arch: Arch;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  binaryName: string;
  binaryExtension: string;
}

/**
 * Detect the current platform and architecture
 */
export function detectPlatform(): PlatformInfo {
  const platform = process.platform as Platform;
  const arch = process.arch as Arch;
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';
  const binaryExtension = isWindows ? '.exe' : '';
  const binaryName = `speakmcp-rs${binaryExtension}`;

  return {
    platform,
    arch,
    isWindows,
    isMac,
    isLinux,
    binaryName,
    binaryExtension,
  };
}

/**
 * Get a human-readable platform description
 */
export function getPlatformDescription(info: PlatformInfo): string {
  const platformNames: Record<Platform, string> = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
  };

  const archNames: Record<Arch, string> = {
    x64: 'x64 (Intel)',
    arm64: 'ARM64 (Apple Silicon / ARM)',
    ia32: 'x86 (32-bit)',
  };

  return `${platformNames[info.platform]} ${archNames[info.arch]}`;
}

