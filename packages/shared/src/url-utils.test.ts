/**
 * URL Utilities Tests
 */

import { describe, it, expect } from "vitest"

import {
  containsUrl,
  containsEmail,
  extractUrls,
  extractEmails,
  removeUrls,
  removeEmails,
  removeUrlsAndEmails,
  isValidUrl,
  getUrlDomain,
  truncateUrl,
  URL_PATTERN,
  EMAIL_PATTERN,
} from './url-utils';

describe('url-utils', () => {
  describe('URL_PATTERN', () => {
    it('should match http URLs', () => {
      expect('http://example.com').toMatch(URL_PATTERN);
    });

    it('should match https URLs', () => {
      expect('https://example.com').toMatch(URL_PATTERN);
    });

    it('should match URLs with paths', () => {
      expect('https://example.com/path/to/page').toMatch(URL_PATTERN);
    });

    it('should match URLs with query params', () => {
      expect('https://example.com?foo=bar&baz=qux').toMatch(URL_PATTERN);
    });

    it('should not match partial URLs', () => {
      expect('example.com').not.toMatch(URL_PATTERN);
    });
  });

  describe('EMAIL_PATTERN', () => {
    it('should match basic email addresses', () => {
      expect('user@example.com').toMatch(EMAIL_PATTERN);
    });

    it('should match emails with subdomains', () => {
      expect('user@mail.example.com').toMatch(EMAIL_PATTERN);
    });

    it('should match emails with plus addressing', () => {
      expect('user+tag@example.com').toMatch(EMAIL_PATTERN);
    });

    it('should match emails with dots in local part', () => {
      expect('first.last@example.com').toMatch(EMAIL_PATTERN);
    });
  });

  describe('containsUrl', () => {
    it('should return true for text with URLs', () => {
      expect(containsUrl('Check out https://example.com')).toBe(true);
    });

    it('should return false for text without URLs', () => {
      expect(containsUrl('Hello world')).toBe(false);
    });

    it('should return false for empty text', () => {
      expect(containsUrl('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(containsUrl(null as unknown as string)).toBe(false);
      expect(containsUrl(undefined as unknown as string)).toBe(false);
    });
  });

  describe('containsEmail', () => {
    it('should return true for text with emails', () => {
      expect(containsEmail('Contact user@example.com')).toBe(true);
    });

    it('should return false for text without emails', () => {
      expect(containsEmail('Hello world')).toBe(false);
    });

    it('should return false for empty text', () => {
      expect(containsEmail('')).toBe(false);
    });
  });

  describe('extractUrls', () => {
    it('should extract a single URL', () => {
      const result = extractUrls('Visit https://example.com today');
      expect(result).toEqual(['https://example.com']);
    });

    it('should extract multiple URLs', () => {
      const result = extractUrls('Check https://one.com and https://two.com');
      expect(result).toEqual(['https://one.com', 'https://two.com']);
    });

    it('should return empty array for no URLs', () => {
      const result = extractUrls('No URLs here');
      expect(result).toEqual([]);
    });

    it('should return empty array for empty text', () => {
      expect(extractUrls('')).toEqual([]);
      expect(extractUrls(null as unknown as string)).toEqual([]);
    });
  });

  describe('extractEmails', () => {
    it('should extract a single email', () => {
      const result = extractEmails('Email user@example.com');
      expect(result).toEqual(['user@example.com']);
    });

    it('should extract multiple emails', () => {
      const result = extractEmails('Contact one@test.com or two@test.com');
      expect(result).toEqual(['one@test.com', 'two@test.com']);
    });

    it('should return empty array for no emails', () => {
      const result = extractEmails('No emails here');
      expect(result).toEqual([]);
    });
  });

  describe('removeUrls', () => {
    it('should replace URL with placeholder', () => {
      const result = removeUrls('Visit https://example.com');
      expect(result).toBe('Visit [web link]');
    });

    it('should support custom placeholder', () => {
      const result = removeUrls('Visit https://example.com', '<URL>');
      expect(result).toBe('Visit <URL>');
    });

    it('should handle multiple URLs', () => {
      const result = removeUrls('Check https://one.com and https://two.com');
      expect(result).toBe('Check [web link] and [web link]');
    });

    it('should leave text without URLs unchanged', () => {
      const result = removeUrls('No URLs here');
      expect(result).toBe('No URLs here');
    });

    it('should return empty string for empty input', () => {
      expect(removeUrls('')).toBe('');
    });
  });

  describe('removeEmails', () => {
    it('should replace email with placeholder', () => {
      const result = removeEmails('Email user@example.com');
      expect(result).toBe('Email [email address]');
    });

    it('should handle multiple emails', () => {
      const result = removeEmails('Contact one@test.com or two@test.com');
      expect(result).toBe('Contact [email address] or [email address]');
    });
  });

  describe('removeUrlsAndEmails', () => {
    it('should remove both URLs and emails', () => {
      const result = removeUrlsAndEmails(
        'Email user@example.com and visit https://example.com'
      );
      expect(result).toBe('Email [email address] and visit [web link]');
    });

    it('should handle text with only URLs', () => {
      const result = removeUrlsAndEmails('Visit https://example.com');
      expect(result).toBe('Visit [web link]');
    });

    it('should handle text with only emails', () => {
      const result = removeUrlsAndEmails('Email user@example.com');
      expect(result).toBe('Email [email address]');
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com?foo=bar')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl(null as unknown as string)).toBe(false);
      expect(isValidUrl(undefined as unknown as string)).toBe(false);
    });
  });

  describe('getUrlDomain', () => {
    it('should extract domain from URL', () => {
      expect(getUrlDomain('https://example.com/page')).toBe('example.com');
      expect(getUrlDomain('http://sub.domain.com/path')).toBe('sub.domain.com');
    });

    it('should return null for invalid URLs', () => {
      expect(getUrlDomain('not a url')).toBe(null);
      expect(getUrlDomain('')).toBe(null);
    });
  });

  describe('truncateUrl', () => {
    it('should return short URLs unchanged', () => {
      const result = truncateUrl('https://ex.com', 50);
      expect(result).toBe('https://ex.com');
    });

    it('should truncate long URLs', () => {
      const longUrl = 'https://example.com/very/long/path/that/exceeds/max/length';
      const result = truncateUrl(longUrl, 40);
      expect(result.length).toBeLessThanOrEqual(40);
      expect(result).toContain('example.com');
    });

    it('should truncate to specified max length', () => {
      const result = truncateUrl('https://example.com/path', 20);
      // The domain takes up space, so result may be shorter than max
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('example.com');
    });

    it('should handle invalid URLs gracefully', () => {
      const result = truncateUrl('not a url', 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});
