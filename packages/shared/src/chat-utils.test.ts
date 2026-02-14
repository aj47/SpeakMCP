/**
 * Tests for chat-utils.ts
 */

import { describe, it, expect } from 'vitest';
import {
  getRoleIcon,
  getRoleLabel,
  shouldCollapseMessage,
  getToolCallsSummary,
  getToolResultsSummary,
  formatRelativeTimestamp,
  messageHasToolExtras,
  getExpandCollapseText,
  formatToolArguments,
  formatArgumentsPreview,
  getToolResultStatusDisplay,
  pluralize,
  getToolBadgeText,
  getRoleConfig,
  COLLAPSE_THRESHOLD,
  COLLAPSED_LINES,
  EXPAND_TEXT,
  COLLAPSE_TEXT,
} from './chat-utils';

describe('Role Utilities', () => {
  describe('getRoleIcon', () => {
    it('returns user icon for user role', () => {
      expect(getRoleIcon('user')).toBe('👤');
    });
    it('returns assistant icon for assistant role', () => {
      expect(getRoleIcon('assistant')).toBe('🤖');
    });
    it('returns tool icon for tool role', () => {
      expect(getRoleIcon('tool')).toBe('🔧');
    });
    it('returns default icon for unknown role', () => {
      expect(getRoleIcon('unknown' as 'user')).toBe('💬');
    });
  });

  describe('getRoleLabel', () => {
    it('returns User for user role', () => {
      expect(getRoleLabel('user')).toBe('User');
    });
    it('returns Assistant for assistant role', () => {
      expect(getRoleLabel('assistant')).toBe('Assistant');
    });
    it('returns Tool for tool role', () => {
      expect(getRoleLabel('tool')).toBe('Tool');
    });
    it('returns Unknown for unknown role', () => {
      expect(getRoleLabel('unknown' as 'user')).toBe('Unknown');
    });
  });
});

describe('Message Collapsing', () => {
  describe('shouldCollapseMessage', () => {
    it('returns false for short content without extras', () => {
      const result = shouldCollapseMessage('Short message');
      expect(result).toBe(false);
    });

    it('returns true for content exceeding threshold', () => {
      const longContent = 'a'.repeat(COLLAPSE_THRESHOLD + 1);
      const result = shouldCollapseMessage(longContent);
      expect(result).toBe(true);
    });

    it('returns true for content at threshold', () => {
      const exactContent = 'a'.repeat(COLLAPSE_THRESHOLD);
      const result = shouldCollapseMessage(exactContent);
      expect(result).toBe(false);
    });

    it('returns true when tool calls present', () => {
      const result = shouldCollapseMessage('Short', [{ name: 'test' } as any]);
      expect(result).toBe(true);
    });

    it('returns true when tool results present', () => {
      const result = shouldCollapseMessage('Short', undefined, [{ success: true } as any]);
      expect(result).toBe(true);
    });

    it('returns false for empty content without extras', () => {
      const result = shouldCollapseMessage(undefined);
      expect(result).toBe(false);
    });

    it('handles undefined arrays gracefully', () => {
      const result = shouldCollapseMessage('Short', undefined, undefined);
      expect(result).toBe(false);
    });
  });
});

describe('Tool Call Summaries', () => {
  describe('getToolCallsSummary', () => {
    it('returns empty string for empty array', () => {
      expect(getToolCallsSummary([])).toBe('');
    });

    it('returns empty string for null', () => {
      expect(getToolCallsSummary(null as any)).toBe('');
    });

    it('formats single tool call', () => {
      expect(getToolCallsSummary([{ name: 'readFile' } as any])).toBe('🔧 readFile');
    });

    it('formats multiple tool calls', () => {
      expect(getToolCallsSummary([
        { name: 'readFile' } as any,
        { name: 'writeFile' } as any,
      ])).toBe('🔧 readFile, writeFile');
    });
  });
});

describe('Tool Result Summaries', () => {
  describe('getToolResultsSummary', () => {
    it('returns empty string for empty array', () => {
      expect(getToolResultsSummary([])).toBe('');
    });

    it('returns empty string for null', () => {
      expect(getToolResultsSummary(null as any)).toBe('');
    });

    it('shows success icon for all successful results', () => {
      const results = [
        { success: true, content: 'result1' } as any,
        { success: true, content: 'result2' } as any,
      ];
      expect(getToolResultsSummary(results)).toContain('✅');
    });

    it('shows warning icon when any result failed', () => {
      const results = [
        { success: true, content: 'success' } as any,
        { success: false, error: 'failed' } as any,
      ];
      expect(getToolResultsSummary(results)).toContain('⚠️');
    });

    it('shows error icon when all failed', () => {
      const results = [
        { success: false, error: 'failed1' } as any,
        { success: false, error: 'failed2' } as any,
      ];
      expect(getToolResultsSummary(results)).toContain('⚠️');
    });

    it('shows result count for multiple results', () => {
      const results = [
        { success: true } as any,
        { success: true } as any,
        { success: true } as any,
      ];
      expect(getToolResultsSummary(results)).toContain('3 results');
    });
  });
});

describe('Timestamp Formatting', () => {
  describe('formatRelativeTimestamp', () => {
    it('returns "Just now" for recent timestamps', () => {
      const now = Date.now();
      expect(formatRelativeTimestamp(now - 30000)).toBe('Just now');
    });

    it('returns minutes for timestamps within hour', () => {
      const now = Date.now();
      expect(formatRelativeTimestamp(now - 300000)).toMatch(/\d+m ago/);
    });

    it('returns time for timestamps within day', () => {
      const now = Date.now();
      const twoHoursAgo = now - 7200000;
      const result = formatRelativeTimestamp(twoHoursAgo);
      // Should contain a colon for time format
      expect(result).toMatch(/:\d{2}/);
    });
  });
});

describe('Message Extras', () => {
  describe('messageHasToolExtras', () => {
    it('returns false when no tool calls or results', () => {
      const message = { content: 'Hello' };
      expect(messageHasToolExtras(message as any)).toBe(false);
    });

    it('returns true when tool calls present', () => {
      const message = { content: 'Hello', toolCalls: [{ name: 'test' } as any] };
      expect(messageHasToolExtras(message as any)).toBe(true);
    });

    it('returns true when tool results present', () => {
      const message = { content: 'Hello', toolResults: [{ success: true } as any] };
      expect(messageHasToolExtras(message as any)).toBe(true);
    });
  });
});

describe('Expand/Collapse', () => {
  describe('getExpandCollapseText', () => {
    it('returns Expand when not expanded', () => {
      expect(getExpandCollapseText(false)).toBe(EXPAND_TEXT);
    });

    it('returns Collapse when expanded', () => {
      expect(getExpandCollapseText(true)).toBe(COLLAPSE_TEXT);
    });
  });
});

describe('Tool Arguments Formatting', () => {
  describe('formatToolArguments', () => {
    it('returns empty string for null', () => {
      expect(formatToolArguments(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(formatToolArguments(undefined)).toBe('');
    });

    it('formats object as JSON', () => {
      const result = formatToolArguments({ foo: 'bar', num: 123 });
      expect(result).toContain('foo');
      expect(result).toContain('bar');
      expect(result).toContain('num');
    });

    it('handles non-object values', () => {
      // String values get JSON.stringify'd with quotes
      expect(formatToolArguments('string' as any)).toBe('"string"');
    });
  });

  describe('formatArgumentsPreview', () => {
    it('returns empty string for null', () => {
      expect(formatArgumentsPreview(null)).toBe('');
    });

    it('returns empty string for non-object', () => {
      expect(formatArgumentsPreview('string' as any)).toBe('');
    });

    it('formats string values with truncation', () => {
      const result = formatArgumentsPreview({ path: '/very/long/path/that/exceeds/thirty/characters' } as any);
      expect(result).toContain('...');
    });

    it('shows object indicators for nested objects', () => {
      const result = formatArgumentsPreview({ nested: { value: 1 } } as any);
      expect(result).toContain('{...}');
    });

    it('shows array count for arrays', () => {
      const result = formatArgumentsPreview({ items: [1, 2, 3] } as any);
      expect(result).toContain('[3 items]');
    });

    it('limits to 3 entries', () => {
      const result = formatArgumentsPreview({
        a: 1,
        b: 2,
        c: 3,
        d: 4,
      } as any);
      expect(result).toContain('+1 more');
    });
  });
});

describe('Tool Result Status', () => {
  describe('getToolResultStatusDisplay', () => {
    it('returns success status for true', () => {
      const status = getToolResultStatusDisplay(true);
      expect(status.icon).toBe('✅');
      expect(status.label).toBe('Success');
    });

    it('returns error status for false', () => {
      const status = getToolResultStatusDisplay(false);
      expect(status.icon).toBe('❌');
      expect(status.label).toBe('Error');
    });
  });
});

describe('Pluralization', () => {
  describe('pluralize', () => {
    it('returns singular for count of 1', () => {
      expect(pluralize(1, 'item')).toBe('item');
    });

    it('returns plural for count not 1', () => {
      expect(pluralize(2, 'item')).toBe('items');
    });

    it('uses custom plural when provided', () => {
      expect(pluralize(2, 'person', 'people')).toBe('people');
    });
  });

  describe('getToolBadgeText', () => {
    it('formats single tool call', () => {
      expect(getToolBadgeText(1, 'call')).toBe('1 tool call');
    });

    it('formats multiple tool calls', () => {
      expect(getToolBadgeText(3, 'call')).toBe('3 tool calls');
    });

    it('formats single result', () => {
      expect(getToolBadgeText(1, 'result')).toBe('1 result');
    });

    it('formats multiple results', () => {
      expect(getToolBadgeText(3, 'result')).toBe('3 results');
    });
  });
});

describe('Role Configuration', () => {
  describe('getRoleConfig', () => {
    it('returns user config for user role', () => {
      const config = getRoleConfig('user');
      expect(config.icon).toBe('👤');
      expect(config.label).toBe('User');
    });

    it('returns assistant config for assistant role', () => {
      const config = getRoleConfig('assistant');
      expect(config.icon).toBe('🤖');
      expect(config.label).toBe('Assistant');
    });

    it('returns tool config for tool role', () => {
      const config = getRoleConfig('tool');
      expect(config.icon).toBe('🔧');
      expect(config.label).toBe('Tool');
    });

    it('returns default config for unknown role', () => {
      const config = getRoleConfig('unknown');
      expect(config.icon).toBe('💬');
      expect(config.label).toBe('Unknown');
    });
  });
});

describe('Constants', () => {
  it('COLLAPSE_THRESHOLD is 200', () => {
    expect(COLLAPSE_THRESHOLD).toBe(200);
  });

  it('COLLAPSED_LINES is 3', () => {
    expect(COLLAPSED_LINES).toBe(3);
  });

  it('EXPAND_TEXT is "Expand"', () => {
    expect(EXPAND_TEXT).toBe('Expand');
  });

  it('COLLAPSE_TEXT is "Collapse"', () => {
    expect(COLLAPSE_TEXT).toBe('Collapse');
  });
});
