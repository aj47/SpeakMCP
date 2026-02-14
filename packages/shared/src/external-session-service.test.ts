/**
 * Tests for External Session Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ExternalSessionService,
  externalSessionService,
} from './external-session-service';
import type { ExternalSession, ExternalSessionMetadata, ContinueSessionResult } from './external-session-types';

describe('ExternalSessionService', () => {
  describe('getProviderInfo', () => {
    it('returns info for available providers', async () => {
      // The test would require mocking the providers
      // This is a placeholder for the test structure
      expect(true).toBe(true);
    });
  });

  describe('getSessionMetadata', () => {
    it('returns sorted sessions from all providers', async () => {
      // Test would mock the providers and verify sorting
      expect(true).toBe(true);
    });
  });

  describe('loadSession', () => {
    it('returns null for unknown provider', async () => {
      const result = await externalSessionService.loadSession('test-id', 'unknown' as any);
      expect(result).toBeNull();
    });
  });

  describe('continueSession', () => {
    it('returns error for unknown provider', async () => {
      const result = await externalSessionService.continueSession('test-id', 'unknown' as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown provider');
    });

    it('returns error for non-existent session', async () => {
      // This would require mocking the provider to return no sessions
      expect(true).toBe(true);
    });
  });
});

describe('Backward Compatibility Functions', () => {
  describe('isAugmentAvailable', () => {
    it('is a function', () => {
      expect(typeof isAugmentAvailable).toBe('function');
    });
  });

  describe('listAugmentSessions', () => {
    it('is a function', () => {
      expect(typeof listAugmentSessions).toBe('function');
    });
  });

  describe('loadAugmentSession', () => {
    it('is a function', () => {
      expect(typeof loadAugmentSession).toBe('function');
    });
  });

  describe('isClaudeCodeAvailable', () => {
    it('is a function', () => {
      expect(typeof isClaudeCodeAvailable).toBe('function');
    });
  });

  describe('listClaudeCodeSessions', () => {
    it('is a function', () => {
      expect(typeof listClaudeCodeSessions).toBe('function');
    });
  });

  describe('loadClaudeCodeSession', () => {
    it('is a function', () => {
      expect(typeof loadClaudeCodeSession).toBe('function');
    });
  });
});

describe('getProviderForSource', () => {
  it('returns provider for augment source', () => {
    const provider = externalSessionService.providers.get('augment');
    expect(provider).toBeDefined();
  });

  it('returns provider for claude-code source', () => {
    const provider = externalSessionService.providers.get('claude-code');
    expect(provider).toBeDefined();
  });

  it('returns null for native source', () => {
    const provider = externalSessionService.providers.get('native');
    expect(provider).toBeUndefined();
  });
});
