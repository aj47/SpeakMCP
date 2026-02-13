/**
 * URL Utilities for SpeakMCP
 * 
 * URL detection, validation, and extraction utilities for text processing.
 */

/**
 * Regular expression pattern for matching HTTP/HTTPS URLs
 */
export const URL_PATTERN = /https?:\/\/[^\s]+/g;

/**
 * Regular expression pattern for matching email addresses
 */
export const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Check if a string contains any URLs
 * 
 * @param text - The text to check for URLs
 * @returns True if the text contains one or more URLs
 */
export function containsUrl(text: string): boolean {
  if (!text) return false;
  return URL_PATTERN.test(text);
}

/**
 * Check if a string contains any email addresses
 * 
 * @param text - The text to check for emails
 * @returns True if the text contains one or more email addresses
 */
export function containsEmail(text: string): boolean {
  if (!text) return false;
  return EMAIL_PATTERN.test(text);
}

/**
 * Extract all URLs from text
 * 
 * @param text - The text to extract URLs from
 * @returns Array of URL strings found in the text
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_PATTERN);
  return matches || [];
}

/**
 * Extract all email addresses from text
 * 
 * @param text - The text to extract emails from
 * @returns Array of email strings found in the text
 */
export function extractEmails(text: string): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_PATTERN);
  return matches || [];
}

/**
 * Remove URLs from text and replace with a placeholder
 * 
 * @param text - The text to process
 * @param placeholder - The placeholder to use (default: "[web link]")
 * @returns Text with URLs replaced by the placeholder
 */
export function removeUrls(text: string, placeholder = "[web link]"): string {
  if (!text) return "";
  return text.replace(URL_PATTERN, placeholder);
}

/**
 * Remove email addresses from text and replace with a placeholder
 * 
 * @param text - The text to process
 * @param placeholder - The placeholder to use (default: "[email address]")
 * @returns Text with emails replaced by the placeholder
 */
export function removeEmails(text: string, placeholder = "[email address]"): string {
  if (!text) return "";
  return text.replace(EMAIL_PATTERN, placeholder);
}

/**
 * Remove both URLs and email addresses from text with appropriate placeholders
 * 
 * @param text - The text to process
 * @returns Text with URLs and emails replaced by descriptive placeholders
 */
export function removeUrlsAndEmails(text: string): string {
  if (!text) return "";
  return removeEmails(removeUrls(text));
}

/**
 * Validate if a string is a valid URL
 * 
 * @param url - The string to validate as a URL
 * @returns True if the string is a valid URL format
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the domain from a URL string
 * 
 * @param url - The URL to extract the domain from
 * @returns The domain part of the URL, or null if invalid
 */
export function getUrlDomain(url: string): string | null {
  if (!isValidUrl(url)) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Truncate a URL for display, showing the domain and a path hint
 * 
 * @param url - The URL to truncate
 * @param maxLength - Maximum length of the result
 * @returns Truncated URL string
 */
export function truncateUrl(url: string, maxLength: number = 50): string {
  if (!url || url.length <= maxLength) return url;
  
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const path = parsed.pathname;
    
    // Show domain + first part of path
    if (domain.length >= maxLength) {
      return domain;
    }
    
    const available = maxLength - domain.length;
    if (available <= 0) return domain;
    
    const truncatedPath = path.length > available - 3 
      ? path.slice(0, available - 3) + "..." 
      : path;
    
    return domain + truncatedPath;
  } catch {
    // Fallback for invalid URLs
    return url.slice(0, maxLength - 3) + "...";
  }
}
