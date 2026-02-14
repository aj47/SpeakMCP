/**
 * Skills Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseSkillMarkdown,
  validateSkillMarkdown,
  generateSkillMarkdown,
  generateSkillTemplate,
  createSkillFromMarkdown,
  isValidSkillName,
  normalizeSkillName,
  getDefaultSkillsDirectory,
} from './skills';

describe('skills', () => {
  describe('parseSkillMarkdown', () => {
    it('should parse valid skill markdown with frontmatter', () => {
      const content = `---
name: test-skill
description: A test skill for validation
---

# Instructions
This is the skill instructions.`;

      const result = parseSkillMarkdown(content);

      expect(result).toEqual({
        name: 'test-skill',
        description: 'A test skill for validation',
        instructions: '# Instructions\nThis is the skill instructions.',
      });
    });

    it('should handle CRLF line endings', () => {
      const content = `---\r\nname: crlf-skill\r\ndescription: Tests CRLF handling\r\n---\r\n\r\n# Instructions\r\nContent here.\r\n`;

      const result = parseSkillMarkdown(content);

      expect(result).toEqual({
        name: 'crlf-skill',
        description: 'Tests CRLF handling',
        instructions: '# Instructions\r\nContent here.',
      });
    });

    it('should return null for invalid format without frontmatter', () => {
      const content = `# Instructions
This has no frontmatter.`;

      const result = parseSkillMarkdown(content);

      expect(result).toBeNull();
    });

    it('should return null when name is missing', () => {
      const content = `---
description: Missing name
---

# Instructions
Content here.`;

      const result = parseSkillMarkdown(content);

      expect(result).toBeNull();
    });

    it('should handle empty description', () => {
      const content = `---
name: no-description-skill
---

# Instructions
Content here.`;

      const result = parseSkillMarkdown(content);

      expect(result).toEqual({
        name: 'no-description-skill',
        description: '',
        instructions: '# Instructions\nContent here.',
      });
    });
  });

  describe('validateSkillMarkdown', () => {
    it('should validate correct skill markdown', () => {
      const content = `---
name: valid-skill
description: A valid skill
---

# Instructions
Valid instructions.`;

      const result = validateSkillMarkdown(content);

      expect(result).toEqual({ isValid: true });
    });

    it('should reject invalid format', () => {
      const content = `# No frontmatter here`;

      const result = validateSkillMarkdown(content);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('YAML frontmatter');
    });

    it('should reject missing name', () => {
      const content = `---
description: No name
---

# Instructions
Content.`;

      const result = validateSkillMarkdown(content);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Expected YAML frontmatter');
    });

    it('should reject missing instructions', () => {
      const content = `---
name: no-instructions
description: Missing instructions
---

`;

      const result = validateSkillMarkdown(content);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('instructions are required');
    });
  });

  describe('generateSkillMarkdown', () => {
    it('should generate valid markdown from skill object', () => {
      const skill = {
        id: 'test-id',
        name: 'generated-skill',
        description: 'Generated from test',
        instructions: '# Do something\nDo it well.',
        enabled: true,
        createdAt: 1000000,
        updatedAt: 1000000,
      };

      const result = generateSkillMarkdown(skill);

      expect(result).toBe(`---
name: generated-skill
description: Generated from test
---

# Do something
Do it well.
`);
    });
  });

  describe('generateSkillTemplate', () => {
    it('should generate template with defaults', () => {
      const result = generateSkillTemplate();

      expect(result).toContain('name: your-skill-name');
      expect(result).toContain('description: Brief description');
      expect(result).toContain('Your Skill Instructions');
    });

    it('should generate template with provided values', () => {
      const result = generateSkillTemplate('my-skill', 'My custom description');

      expect(result).toContain('name: my-skill');
      expect(result).toContain('description: My custom description');
    });
  });

  describe('createSkillFromMarkdown', () => {
    it('should create skill with defaults', () => {
      const content = `---
name: new-skill
description: A new skill
---

# Instructions
Do work.`;

      const result = createSkillFromMarkdown(content);

      expect(result.name).toBe('new-skill');
      expect(result.description).toBe('A new skill');
      expect(result.instructions).toBe('# Instructions\nDo work.');
      expect(result.enabled).toBe(true);
      expect(result.source).toBe('local');
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create skill with custom options', () => {
      const content = `---
name: imported-skill
description: From external source
---

# Instructions
Import me.`;

      const result = createSkillFromMarkdown(content, {
        source: 'imported',
        filePath: '/path/to/skill/SKILL.md',
        sourceDirectory: 'external-skills',
      });

      expect(result.source).toBe('imported');
      expect(result.filePath).toBe('/path/to/skill/SKILL.md');
      expect(result.sourceDirectory).toBe('external-skills');
    });

    it('should throw for invalid content', () => {
      const invalidContent = `# No frontmatter`;

      expect(() => createSkillFromMarkdown(invalidContent)).toThrow('Invalid SKILL.md format');
    });
  });

  describe('isValidSkillName', () => {
    it('should accept valid names', () => {
      expect(isValidSkillName('simple')).toBe(true);
      expect(isValidSkillName('with-spaces')).toBe(true);
      expect(isValidSkillName('with_underscore')).toBe(true);
      expect(isValidSkillName('Test-Name-123')).toBe(true);
    });

    it('should reject empty names', () => {
      expect(isValidSkillName('')).toBe(false);
      expect(isValidSkillName('   ')).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(isValidSkillName('has@symbol')).toBe(false);
      expect(isValidSkillName('has/slash')).toBe(false);
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(101);
      expect(isValidSkillName(longName)).toBe(false);
    });
  });

  describe('normalizeSkillName', () => {
    it('should convert to lowercase', () => {
      expect(normalizeSkillName('MySkill')).toBe('myskill');
    });

    it('should replace spaces and underscores with hyphens', () => {
      expect(normalizeSkillName('my skill')).toBe('my-skill');
      expect(normalizeSkillName('my_skill')).toBe('my-skill');
      expect(normalizeSkillName('my skill_name')).toBe('my-skill-name');
    });

    it('should remove special characters', () => {
      expect(normalizeSkillName('My@Skill!')).toBe('myskill');
    });

    it('should handle leading/trailing whitespace', () => {
      expect(normalizeSkillName('  my-skill  ')).toBe('my-skill');
    });
  });

  describe('getDefaultSkillsDirectory', () => {
    it('should return macOS path', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const result = getDefaultSkillsDirectory('testapp');

      expect(result).toContain('Library/Application Support/testapp/skills');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return Linux path', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = getDefaultSkillsDirectory('testapp');

      expect(result).toContain('.config/testapp/skills');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should use default app name', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = getDefaultSkillsDirectory();

      expect(result).toContain('speakmcp/skills');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });
});
