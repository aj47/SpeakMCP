import { describe, it, expect } from 'vitest'
import { preprocessTextForTTS, validateTTSText } from './tts-preprocessing'

describe('TTS Preprocessing - Thinking Blocks', () => {
  it('should remove simple thinking blocks', () => {
    const input = 'Here is my answer. <think>This is my reasoning process.</think> The final answer is 42.'
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: true,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    expect(result).not.toContain('<think>')
    expect(result).not.toContain('</think>')
    expect(result).not.toContain('This is my reasoning process')
    expect(result).toContain('Here is my answer')
    expect(result).toContain('The final answer is 42')
  })

  it('should remove multiline thinking blocks', () => {
    const input = `Let me help you with that.
<think>
First, I need to analyze the problem.
Then I'll break it down into steps.
Finally, I'll provide the solution.
</think>
The solution is to use the preprocessTextForTTS function.`
    
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: true,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    
    expect(result).not.toContain('<think>')
    expect(result).not.toContain('</think>')
    expect(result).not.toContain('analyze the problem')
    expect(result).toContain('Let me help you with that')
    expect(result).toContain('The solution is to use the preprocessTextForTTS function')
  })

  it('should remove multiple thinking blocks', () => {
    const input = 'First part. <think>Reasoning 1</think> Middle part. <think>Reasoning 2</think> Last part.'
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: true,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    
    expect(result).not.toContain('Reasoning 1')
    expect(result).not.toContain('Reasoning 2')
    expect(result).toContain('First part')
    expect(result).toContain('Middle part')
    expect(result).toContain('Last part')
  })

  it('should handle case-insensitive thinking tags', () => {
    const input = 'Answer here. <THINK>Reasoning</THINK> More answer. <Think>More reasoning</Think> Final.'
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: true,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    
    expect(result).not.toContain('Reasoning')
    expect(result).not.toContain('More reasoning')
    expect(result).toContain('Answer here')
    expect(result).toContain('More answer')
    expect(result).toContain('Final')
  })

  it('should not remove thinking blocks when option is disabled', () => {
    const input = 'Text with <think>reasoning</think> included.'
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: false,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    
    expect(result).toContain('reasoning')
  })

  it('should handle text without thinking blocks', () => {
    const input = 'This is just regular text without any thinking blocks.'
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: true,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    
    expect(result).toContain('This is just regular text without any thinking blocks')
  })

  it('should remove thinking blocks with default options', () => {
    const input = 'Answer. <think>Internal reasoning.</think> Final answer.'
    const result = preprocessTextForTTS(input)
    
    expect(result).not.toContain('Internal reasoning')
    expect(result).toContain('Answer')
    expect(result).toContain('Final answer')
  })

  it('should handle nested or malformed tags gracefully', () => {
    const input = 'Text <think>reasoning <think>nested</think> more</think> end.'
    const result = preprocessTextForTTS(input, { 
      removeThinkingBlocks: true,
      removeCodeBlocks: false,
      removeUrls: false,
      convertMarkdown: false,
      removeSymbols: false,
      convertNumbers: false
    })
    
    // The regex should remove the first <think>...</think> pair it finds
    expect(result).not.toContain('reasoning')
  })
})

describe('TTS Preprocessing - Integration', () => {
  it('should remove thinking blocks before other processing', () => {
    const input = 'Here is **bold text**. <think>This has `code` inside.</think> Final answer with https://example.com link.'
    const result = preprocessTextForTTS(input)
    
    // Thinking block should be removed
    expect(result).not.toContain('This has')
    expect(result).not.toContain('code')
    
    // Other processing should still work
    expect(result).toContain('bold text')
    expect(result).not.toContain('**')
    expect(result).not.toContain('https://')
  })
})

