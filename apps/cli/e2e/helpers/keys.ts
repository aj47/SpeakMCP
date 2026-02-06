/**
 * Terminal key escape sequences for PTY interaction
 */
export const KEYS = {
  // Function keys
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',

  // Navigation
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  RIGHT: '\x1b[C',
  LEFT: '\x1b[D',
  HOME: '\x1b[H',
  END: '\x1b[F',
  PAGE_UP: '\x1b[5~',
  PAGE_DOWN: '\x1b[6~',

  // Common keys
  ENTER: '\r',
  TAB: '\t',
  BACKSPACE: '\x7f',
  DELETE: '\x1b[3~',
  ESCAPE: '\x1b',
  SPACE: ' ',

  // Control keys
  CTRL_A: '\x01',
  CTRL_B: '\x02',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_E: '\x05',
  CTRL_K: '\x0b',
  CTRL_L: '\x0c',
  CTRL_N: '\x0e',
  CTRL_P: '\x10',
  CTRL_Q: '\x11',
  CTRL_R: '\x12',
  CTRL_U: '\x15',
  CTRL_W: '\x17',
  CTRL_Z: '\x1a',
} as const

export type KeyName = keyof typeof KEYS

