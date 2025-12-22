/**
 * PMPM CLI - SpeakMCP Package Manager
 * 
 * Cross-platform CLI that bundles Rust binary management into dev/build/install commands.
 * 
 * Usage:
 *   pmpm dev [args...]     - Start development server (auto-builds Rust binary if needed)
 *   pmpm build [args...]   - Build production app (includes Rust binary)
 *   pmpm install           - Install dependencies and Rust binary
 *   pmpm status            - Show current project status
 *   pmpm help              - Show help
 */

import { devCommand, buildCommand, installCommand, statusCommand } from './commands.js';
import { logger } from './logger.js';

const VERSION = '1.1.0';

function showHelp(): void {
  console.log(`
${'\x1b[1m'}PMPM - SpeakMCP Package Manager${'\x1b[0m'} v${VERSION}

Cross-platform CLI that bundles Rust binary management into dev/build/install commands.

${'\x1b[1m'}Usage:${'\x1b[0m'}
  pmpm <command> [options]

${'\x1b[1m'}Commands:${'\x1b[0m'}
  dev [args...]      Start development server
                     Automatically checks/builds Rust binary if needed
                     Builds shared package first
                     Passes additional args to electron-vite

  build [args...]    Build production application
                     Builds Rust binary for current platform
                     Builds shared package first
                     Passes additional args to electron-builder

  install            Install all dependencies
                     Runs pnpm install
                     Builds shared package
                     Builds Rust binary if needed

  status             Show current project status
                     Displays Rust binary status
                     Shows project paths

  help, --help, -h   Show this help message
  version, -v        Show version

${'\x1b[1m'}Examples:${'\x1b[0m'}
  pmpm dev                    # Start dev server
  pmpm dev debug-all          # Start with all debug flags
  pmpm build                  # Build for current platform
  pmpm install                # Fresh install

${'\x1b[1m'}Debug Flags (for dev):${'\x1b[0m'}
  debug-all, d                # All debug modes
  debug-llm                   # LLM calls and responses
  debug-tools                 # MCP tool execution
  debug-ui                    # UI focus, renders, state changes
`);
}

function showVersion(): void {
  console.log(`pmpm v${VERSION}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'dev':
      devCommand(commandArgs);
      break;

    case 'build':
      buildCommand(commandArgs);
      break;

    case 'install':
      installCommand(commandArgs);
      break;

    case 'status':
      statusCommand();
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;

    case 'version':
    case '-v':
    case '--version':
      showVersion();
      break;

    default:
      logger.error(`Unknown command: ${command}`);
      logger.info('Run "pmpm help" for usage information');
      process.exit(1);
  }
}

main();

