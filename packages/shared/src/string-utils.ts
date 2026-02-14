/**
 * String Utilities for SpeakMCP
 * 
 * Text processing utilities for truncation, counting, and markdown stripping.
 * These utilities provide consistent text handling across SpeakMCP apps.
 */

/**
 * Result object for extractSummary operation
 */
export interface ExtractSummaryResult {
  text: string;
  extractedLength: number;
  mode: 'sentences' | 'words';
  truncated: boolean;
}

/**
 * Truncates text at a natural boundary (sentence or word) without cutting words mid-way.
 * Prefers sentence boundaries, falls back to word boundaries.
 * 
 * @param text - The text to truncate
 * @param maxLength - Maximum allowed length
 * @returns Truncated text ending at a natural boundary with ellipsis if truncated
 */
export function truncateAtBoundary(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength);

  // Find the last occurrence of sentence-ending punctuation
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExclamation = truncated.lastIndexOf('!');
  const lastQuestion = truncated.lastIndexOf('?');
  
  let lastPunct = Math.max(lastPeriod, lastExclamation, lastQuestion);
  
  // Check if the punctuation is followed by space or end of string
  if (lastPunct >= 0) {
    const afterPunct = truncated[lastPunct + 1];
    // If punctuation is at end or followed by space/newline, it's a sentence end
    if (!afterPunct || afterPunct === ' ' || afterPunct === '\n') {
      const sentenceEnd = lastPunct + 1;
      // Only use if it's past 60% of maxLength (meaning we got most of the content)
      if (sentenceEnd > maxLength * 0.6) {
        return truncated.slice(0, sentenceEnd).trim();
      }
    }
  }

  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace).trim() + '...';
  }

  // If no good boundary found, hard truncate with ellipsis
  return truncated.trimEnd() + '...';
}

/**
 * Counts the number of words in a string.
 * Words are defined as sequences of non-whitespace characters.
 * 
 * @param text - The text to count words in
 * @returns The number of words
 */
export function wordCount(text: string): number {
  if (!text || !text.trim()) {
    return 0;
  }
  return text.trim().split(/\s+/).length;
}

/**
 * Removes all markdown formatting from text.
 * Handles: bold, italic, strikethrough, code blocks, inline code, 
 * headings, links, images, lists, blockquotes, and horizontal rules.
 * 
 * @param text - The text with markdown formatting
 * @returns Clean text with all markdown removed
 */
export function stripMarkdown(text: string): string {
  if (!text) {
    return '';
  }

  let result = text;

  // Code blocks (multiline)
  result = result.replace(/```[\s\S]*?```/g, '');

  // Inline code
  result = result.replace(/`([^`]+)`/g, '$1');

  // Bold (both ** and __)
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');

  // Italic (both * and _)
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');

  // Strikethrough
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // Links: [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Images: ![alt](url) -> remove completely (including the !)
  result = result.replace(/!?\[[^\]]*\]\([^)]+\)\s*/g, '');

  // Headings: #, ##, ###, etc.
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes
  result = result.replace(/^>\s*/gm, '');

  // Unordered lists
  result = result.replace(/^[\s]*[-*+]\s+/gm, '');

  // Ordered lists
  result = result.replace(/^[\s]*\d+\.\s+/gm, '');

  // Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, '');

  // Remove extra whitespace created by removals
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // Convert newlines to spaces for cleaner output
  result = result.replace(/\n/g, ' ');

  return result.trim();
}

/**
 * Quickly checks if text exceeds the maximum length.
 * More efficient than checking text.length > maxLength for very large texts.
 * 
 * @param text - The text to check
 * @param maxLength - Maximum allowed length
 * @returns true if text exceeds maxLength, false otherwise
 */
export function exceedsMaxLength(text: string, maxLength: number): boolean {
  if (!text) {
    return false;
  }
  return text.length > maxLength;
}

/**
 * Extracts a summary from the beginning of the text.
 * Can extract by sentences or by words.
 * 
 * @param text - The full text to summarize
 * @param maxLength - Maximum length of the summary
 * @param mode - Extraction mode: 'sentences' or 'words'
 * @returns An object containing the extracted summary and metadata
 */
export function extractSummary(
  text: string,
  maxLength: number,
  mode: 'sentences' | 'words' = 'sentences'
): ExtractSummaryResult {
  if (!text) {
    return { text: '', extractedLength: 0, mode, truncated: false };
  }

  if (text.length <= maxLength) {
    return { text, extractedLength: text.length, mode, truncated: false };
  }

  if (mode === 'sentences') {
    // Split text into sentences using a more robust approach
    const sentences: string[] = [];
    let currentSentence = '';
    let i = 0;
    
    while (i < text.length) {
      const char = text[i];
      currentSentence += char;
      
      // Check for sentence-ending punctuation
      if (['.', '!', '?'].includes(char)) {
        // Check if next char is end or whitespace (end of sentence)
        const nextChar = text[i + 1];
        if (!nextChar || /\s/.test(nextChar)) {
          sentences.push(currentSentence.trim());
          currentSentence = '';
        }
      }
      i++;
    }
    
    // Add any remaining text as a sentence
    if (currentSentence.trim()) {
      sentences.push(currentSentence.trim());
    }

    // Handle case where no sentences were found (no punctuation)
    if (sentences.length === 0 && text.trim()) {
      sentences.push(text.trim());
    }

    let extracted = '';
    let extractedLength = 0;

    for (const sentence of sentences) {
      const sentenceLength = sentence.length;

      if (extractedLength + sentenceLength <= maxLength) {
        extracted += (extracted ? ' ' : '') + sentence;
        extractedLength += sentence.length + (extracted ? 1 : 0);
      } else {
        // Try to fit part of this sentence
        const remaining = maxLength - extractedLength;
        if (remaining > 10) { // Only if we can add meaningful content
          extracted += (extracted ? ' ' : '') + truncateAtBoundary(sentence, remaining);
          extractedLength = extracted.length;
        }
        break;
      }
    }

    return {
      text: extracted.trim(),
      extractedLength: extracted.trim().length,
      mode,
      truncated: extractedLength < text.length
    };
  } else {
    // Extract by words
    const words = text.split(/\s+/);
    let extracted = '';
    let wordCount = 0;

    for (const word of words) {
      const withSpace = extracted ? word + ' ' : word;
      if (extracted.length + withSpace.length <= maxLength) {
        extracted += withSpace;
        wordCount++;
      } else {
        break;
      }
    }

    return {
      text: extracted.trim(),
      extractedLength: extracted.trim().length,
      mode,
      truncated: true
    };
  }
}
