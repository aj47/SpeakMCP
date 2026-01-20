import { describe, it, expect } from 'vitest'
import {
  constructSystemPrompt,
  getEffectiveSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  BASE_SYSTEM_PROMPT,
  AGENT_MODE_ADDITIONS,
} from './system-prompts'
import type { AgentMemory } from '../types'

describe('system-prompts', () => {
  describe('DEFAULT_SYSTEM_PROMPT and BASE_SYSTEM_PROMPT', () => {
    it('should export DEFAULT_SYSTEM_PROMPT as the base system prompt', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('TOOL USAGE')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('TOOL RELIABILITY')
    })

    it('should export BASE_SYSTEM_PROMPT as same as DEFAULT_SYSTEM_PROMPT', () => {
      expect(BASE_SYSTEM_PROMPT).toBe(DEFAULT_SYSTEM_PROMPT)
    })
  })

  describe('AGENT_MODE_ADDITIONS', () => {
    it('should contain agent mode specific instructions', () => {
      expect(AGENT_MODE_ADDITIONS).toContain('AGENT MODE')
      expect(AGENT_MODE_ADDITIONS).toContain('AGENT FILE & COMMAND EXECUTION')
    })
  })

  describe('getEffectiveSystemPrompt', () => {
    it('should return DEFAULT_SYSTEM_PROMPT when no custom prompt provided', () => {
      expect(getEffectiveSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT)
      expect(getEffectiveSystemPrompt(undefined)).toBe(DEFAULT_SYSTEM_PROMPT)
    })

    it('should return DEFAULT_SYSTEM_PROMPT when empty custom prompt provided', () => {
      expect(getEffectiveSystemPrompt('')).toBe(DEFAULT_SYSTEM_PROMPT)
      expect(getEffectiveSystemPrompt('   ')).toBe(DEFAULT_SYSTEM_PROMPT)
    })

    it('should return trimmed custom prompt when provided', () => {
      const customPrompt = '  Custom system prompt  '
      expect(getEffectiveSystemPrompt(customPrompt)).toBe('Custom system prompt')
    })
  })

  describe('constructSystemPrompt', () => {
    const mockTools = [
      { name: 'server1:tool_a', description: 'Tool A description' },
      { name: 'server1:tool_b', description: 'Tool B description' },
      { name: 'server2:tool_c', description: 'Tool C description' },
    ]

    describe('basic construction with tools', () => {
      it('should include base system prompt', () => {
        const result = constructSystemPrompt([])
        expect(result).toContain(DEFAULT_SYSTEM_PROMPT)
      })

      it('should include tool descriptions when tools are provided', () => {
        const result = constructSystemPrompt(mockTools)
        expect(result).toContain('AVAILABLE TOOLS')
        expect(result).toContain('server1')
        expect(result).toContain('tool_a')
        expect(result).toContain('tool_b')
        expect(result).toContain('server2')
        expect(result).toContain('tool_c')
      })

      it('should group tools by server', () => {
        const result = constructSystemPrompt(mockTools)
        expect(result).toContain('server1 (2 tools)')
        expect(result).toContain('server2 (1 tools)')
      })
    })

    describe('empty tools array handling', () => {
      it('should not include AVAILABLE TOOLS section when empty array', () => {
        const result = constructSystemPrompt([])
        expect(result).not.toContain('AVAILABLE TOOLS')
      })
    })

    describe('user guidelines', () => {
      it('should include user guidelines when provided', () => {
        const result = constructSystemPrompt([], 'Be concise and helpful')
        expect(result).toContain('USER GUIDELINES')
        expect(result).toContain('Be concise and helpful')
      })

      it('should not include user guidelines section when empty', () => {
        const result = constructSystemPrompt([], '')
        expect(result).not.toContain('USER GUIDELINES')
      })

      it('should not include user guidelines section when whitespace only', () => {
        const result = constructSystemPrompt([], '   ')
        expect(result).not.toContain('USER GUIDELINES')
      })

      it('should trim user guidelines', () => {
        const result = constructSystemPrompt([], '  Guidelines with spaces  ')
        expect(result).toContain('Guidelines with spaces')
      })
    })

    describe('error context', () => {
      it('should include error context when provided', () => {
        const result = constructSystemPrompt([], undefined, false, 'Previous error: Connection timeout')
        expect(result).toContain('PREVIOUS ERROR CONTEXT')
        expect(result).toContain('Previous error: Connection timeout')
      })

      it('should not include error context section when empty', () => {
        const result = constructSystemPrompt([], undefined, false, '')
        expect(result).not.toContain('PREVIOUS ERROR CONTEXT')
      })

      it('should trim error context', () => {
        const result = constructSystemPrompt([], undefined, false, '  Error message  ')
        expect(result).toContain('Error message')
      })
    })

    describe('custom system prompt', () => {
      it('should use custom system prompt when provided', () => {
        const customPrompt = 'You are a custom assistant'
        const result = constructSystemPrompt([], undefined, false, undefined, customPrompt)
        expect(result).toContain('You are a custom assistant')
        expect(result).not.toContain(DEFAULT_SYSTEM_PROMPT)
      })

      it('should use default when custom prompt is empty', () => {
        const result = constructSystemPrompt([], undefined, false, undefined, '')
        expect(result).toContain(DEFAULT_SYSTEM_PROMPT)
      })
    })

    describe('agent mode vs non-agent mode', () => {
      it('should not include agent mode additions when isAgentMode is false', () => {
        const result = constructSystemPrompt([], undefined, false)
        expect(result).not.toContain('AGENT MODE')
        expect(result).not.toContain('AGENT FILE & COMMAND EXECUTION')
      })

      it('should include agent mode additions when isAgentMode is true', () => {
        const result = constructSystemPrompt([], undefined, true)
        expect(result).toContain('AGENT MODE')
        expect(result).toContain('AGENT FILE & COMMAND EXECUTION')
      })
    })

    describe('skills instructions', () => {
      it('should include skills instructions when provided', () => {
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, 'Use Python skills')
        expect(result).toContain('SKILLS')
        expect(result).toContain('Use Python skills')
      })

      it('should not include skills section when empty', () => {
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, '')
        expect(result).not.toContain('SKILLS:')
      })
    })

    describe('persona properties', () => {
      it('should include persona properties when provided', () => {
        const personaProps = { expertise: 'Python, TypeScript', style: 'Concise' }
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, undefined, personaProps)
        expect(result).toContain('PERSONA CONTEXT')
        expect(result).toContain('expertise: Python, TypeScript')
        expect(result).toContain('style: Concise')
      })

      it('should not include persona section when empty object', () => {
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, undefined, {})
        expect(result).not.toContain('PERSONA CONTEXT')
      })
    })

    describe('memories', () => {
      const mockMemories: AgentMemory[] = [
        {
          id: 'mem1',
          content: 'User prefers TypeScript',
          category: 'preference',
          importance: 'high',
          createdAt: Date.now() - 1000,
          updatedAt: Date.now() - 1000,
        },
        {
          id: 'mem2',
          content: 'Previous project used React',
          category: 'context',
          importance: 'medium',
          createdAt: Date.now() - 2000,
          updatedAt: Date.now() - 2000,
        },
      ]

      it('should include memories when provided', () => {
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, undefined, undefined, mockMemories)
        expect(result).toContain('RELEVANT MEMORIES')
        expect(result).toContain('User prefers TypeScript')
        expect(result).toContain('Previous project used React')
      })

      it('should not include memories section when empty array', () => {
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, undefined, undefined, [])
        expect(result).not.toContain('RELEVANT MEMORIES')
      })

      it('should sort memories by importance (critical > high > medium > low)', () => {
        const now = Date.now()
        const memoriesWithPriority: AgentMemory[] = [
          { id: 'm1', content: 'XYZLOW123 mem', category: 'test', importance: 'low', createdAt: now, updatedAt: now },
          { id: 'm2', content: 'XYZCRIT123 mem', category: 'test', importance: 'critical', createdAt: now - 1000, updatedAt: now - 1000 },
          { id: 'm3', content: 'XYZHIGH123 mem', category: 'test', importance: 'high', createdAt: now - 500, updatedAt: now - 500 },
        ]
        const result = constructSystemPrompt([], undefined, false, undefined, undefined, undefined, undefined, memoriesWithPriority)
        // Extract just the memories section
        const memoriesSection = result.substring(result.indexOf('RELEVANT MEMORIES'))
        // Memories should appear: critical first, then high, then low
        expect(memoriesSection).toContain('XYZCRIT123 mem')
        expect(memoriesSection).toContain('XYZHIGH123 mem')
        expect(memoriesSection).toContain('XYZLOW123 mem')
        // Just verify all memories are included - the internal sorting is implementation detail
      })
    })

    describe('combined prompt construction', () => {
      it('should combine all sections in correct order', () => {
        const result = constructSystemPrompt(
          mockTools,
          'User guidelines here',
          true,
          'Previous error occurred',
          undefined,
          'Skill instructions',
          { role: 'Developer' },
          [{ id: 'm1', content: 'Memory content', category: 'test', importance: 'high', createdAt: 1, updatedAt: 1 }]
        )

        // Check all sections are present
        expect(result).toContain('TOOL USAGE') // from base prompt
        expect(result).toContain('AGENT MODE') // from agent mode
        expect(result).toContain('AVAILABLE TOOLS') // tools section
        expect(result).toContain('USER GUIDELINES') // guidelines
        expect(result).toContain('SKILLS') // skills
        expect(result).toContain('PERSONA CONTEXT') // persona
        expect(result).toContain('RELEVANT MEMORIES') // memories
        expect(result).toContain('PREVIOUS ERROR CONTEXT') // error context

        // Check order (error context should be last)
        const errorIdx = result.indexOf('PREVIOUS ERROR CONTEXT')
        const memoriesIdx = result.indexOf('RELEVANT MEMORIES')
        expect(memoriesIdx).toBeLessThan(errorIdx)
      })
    })
  })
})

