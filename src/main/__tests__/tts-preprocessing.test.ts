/**
 * Unit tests for TTS text preprocessing functionality
 */

import { describe, it, expect } from 'vitest'
import { 
  preprocessTextForTTS, 
  validateTTSText,
  TTSPreprocessingOptions 
} from '../tts-preprocessing'

describe('TTS Text Preprocessing', () => {
  describe('preprocessTextForTTS', () => {
    it('should remove code blocks and replace with descriptive text', () => {
      const input = 'Here is some code:\n```javascript\nconst x = 1;\n```\nThat was code.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('[code block]')
      expect(result).not.toContain('```')
      expect(result).not.toContain('const x = 1;')
    })

    it('should remove inline code and keep content', () => {
      const input = 'Use the `console.log()` function to debug.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('console.log()')
      expect(result).not.toContain('`')
    })

    it('should replace URLs with descriptive text', () => {
      const input = 'Visit https://example.com for more info.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('[web link]')
      expect(result).not.toContain('https://example.com')
    })

    it('should replace email addresses with descriptive text', () => {
      const input = 'Contact us at support@example.com for help.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('[email address]')
      expect(result).not.toContain('support@example.com')
    })

    it('should convert markdown headers to spoken form', () => {
      const input = '# Main Title\n## Subtitle\nContent here.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('Heading: Main Title.')
      expect(result).toContain('Heading: Subtitle.')
      expect(result).not.toContain('#')
    })

    it('should convert markdown lists to spoken form', () => {
      const input = '- First item\n- Second item\n1. Numbered item'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('Item: First item.')
      expect(result).toContain('Item: Second item.')
      expect(result).toContain('Item: Numbered item.')
    })

    it('should convert markdown links to just text', () => {
      const input = 'Check out [this link](https://example.com) for details.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('this link')
      expect(result).not.toContain('[this link]')
      expect(result).not.toContain('(https://example.com)')
    })

    it('should replace programming symbols with words', () => {
      const input = 'x >= 5 && y !== null'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('greater than or equal')
      expect(result).toContain('and')
      expect(result).toContain('not equals')
    })

    it('should convert version numbers to spoken form', () => {
      const input = 'Version v1.2.3 is available.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('version 1 point 2 point 3')
      expect(result).not.toContain('v1.2.3')
    })

    it('should normalize whitespace', () => {
      const input = 'Text   with    multiple     spaces.'
      const result = preprocessTextForTTS(input)
      
      expect(result).toBe('Text with multiple spaces.')
    })

    it('should truncate text if too long', () => {
      const longText = 'A'.repeat(5000)
      const options: TTSPreprocessingOptions = { maxLength: 100 }
      const result = preprocessTextForTTS(longText, options)
      
      expect(result.length).toBeLessThanOrEqual(103) // 100 + "..."
      expect(result).toEndWith('...')
    })

    it('should respect preprocessing options', () => {
      const input = 'Visit https://example.com and see ```code```'
      const options: TTSPreprocessingOptions = {
        removeUrls: false,
        removeCodeBlocks: false
      }
      const result = preprocessTextForTTS(input, options)
      
      expect(result).toContain('https://example.com')
      expect(result).toContain('```')
    })

    it('should handle empty input', () => {
      const result = preprocessTextForTTS('')
      expect(result).toBe('')
    })

    it('should handle input with only whitespace', () => {
      const result = preprocessTextForTTS('   \n\t   ')
      expect(result).toBe('')
    })
  })

  describe('validateTTSText', () => {
    it('should validate normal text as valid', () => {
      const result = validateTTSText('This is normal text for TTS.')
      
      expect(result.isValid).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.processedLength).toBeGreaterThan(0)
    })

    it('should reject empty text', () => {
      const result = validateTTSText('')
      
      expect(result.isValid).toBe(false)
      expect(result.issues).toContain('Text is empty')
    })

    it('should reject text that is too long', () => {
      const longText = 'A'.repeat(15000)
      const result = validateTTSText(longText)
      
      expect(result.isValid).toBe(false)
      expect(result.issues).toContain('Text is too long for TTS')
    })

    it('should detect unprocessed code blocks', () => {
      const result = validateTTSText('Some text with ```unprocessed code```')
      
      expect(result.isValid).toBe(false)
      expect(result.issues).toContain('Contains unprocessed code blocks')
    })

    it('should detect unprocessed URLs', () => {
      const result = validateTTSText('Text with https://unprocessed-url.com')
      
      expect(result.isValid).toBe(false)
      expect(result.issues).toContain('Contains unprocessed URLs')
    })

    it('should return multiple issues when present', () => {
      const result = validateTTSText('```code``` and https://url.com')
      
      expect(result.isValid).toBe(false)
      expect(result.issues).toHaveLength(2)
      expect(result.issues).toContain('Contains unprocessed code blocks')
      expect(result.issues).toContain('Contains unprocessed URLs')
    })
  })

  describe('Edge cases', () => {
    it('should handle mixed content correctly', () => {
      const input = `
# API Documentation

Visit our API at https://api.example.com

## Code Example

\`\`\`javascript
const response = await fetch('/api/data');
const data = await response.json();
\`\`\`

For support, email support@example.com

- Feature 1: Works great
- Feature 2: Also works
      `
      
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('Heading: API Documentation.')
      expect(result).toContain('Heading: Code Example.')
      expect(result).toContain('[web link]')
      expect(result).toContain('[email address]')
      expect(result).toContain('[code block]')
      expect(result).toContain('Item: Feature 1: Works great.')
      expect(result).not.toContain('```')
      expect(result).not.toContain('https://')
      expect(result).not.toContain('@')
    })

    it('should handle special characters and unicode', () => {
      const input = 'Special chars: © ® ™ and unicode: 🚀 🎉'
      const result = preprocessTextForTTS(input)
      
      expect(result).toContain('Special chars')
      expect(result).toContain('unicode')
      // Should preserve unicode characters as they might be readable by TTS
    })
  })
})
