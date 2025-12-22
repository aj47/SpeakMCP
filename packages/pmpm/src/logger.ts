/**
 * Logging utilities for pmpm CLI
 */

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

export const logger = {
  info(message: string): void {
    console.log(`${colorize('ℹ', 'blue')} ${message}`);
  },

  success(message: string): void {
    console.log(`${colorize('✓', 'green')} ${message}`);
  },

  warn(message: string): void {
    console.log(`${colorize('⚠', 'yellow')} ${message}`);
  },

  error(message: string): void {
    console.error(`${colorize('✖', 'red')} ${message}`);
  },

  step(message: string): void {
    console.log(`${colorize('→', 'cyan')} ${message}`);
  },

  command(message: string): void {
    console.log(`${colorize('$', 'dim')} ${colorize(message, 'dim')}`);
  },

  header(message: string): void {
    console.log();
    console.log(`${colorize(message, 'bold')}`);
    console.log(colorize('─'.repeat(message.length), 'dim'));
  },

  newline(): void {
    console.log();
  },
};

