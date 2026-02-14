/**
 * Skills utilities for parsing and generating SKILL.md files.
 * Ported from acp-remote for SpeakMCP integration.
 */

import type { AgentSkill } from './types.js';

/**
 * Parse a SKILL.md file content into skill metadata and instructions.
 * 
 * Format:
 * ---
 * name: skill-name
 * description: Description of what skill does
 * ---
 * 
 * # Instructions
 * [Markdown content]
 * 
 * @param content - The raw SKILL.md file content
 * @returns Parsed skill data or null if invalid format
 */
export function parseSkillMarkdown(
  content: string
): { name: string; description: string; instructions: string } | null {
  // Use \r?\n to handle both Unix (LF) and Windows (CRLF) line endings
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No valid frontmatter found - return null to indicate invalid format
    // Note: Skills without frontmatter are not supported; a valid SKILL.md must have
    // YAML frontmatter with at least a 'name' field
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const instructions = frontmatterMatch[2].trim();

  // Parse YAML-like frontmatter (simple key: value pairs)
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);

  if (!nameMatch) {
    return null;
  }

  return {
    name: nameMatch[1].trim(),
    description: descriptionMatch ? descriptionMatch[1].trim() : '',
    instructions,
  };
}

/**
 * Validate a SKILL.md file content.
 * 
 * @param content - The raw SKILL.md file content
 * @returns Object with isValid flag and error message if invalid
 */
export function validateSkillMarkdown(
  content: string
): { isValid: boolean; error?: string } {
  const parsed = parseSkillMarkdown(content);

  if (!parsed) {
    return {
      isValid: false,
      error: 'Invalid SKILL.md format. Expected YAML frontmatter with "name" field.',
    };
  }

  if (!parsed.name || parsed.name.trim().length === 0) {
    return {
      isValid: false,
      error: 'Skill name is required in frontmatter.',
    };
  }

  if (!parsed.instructions || parsed.instructions.trim().length === 0) {
    return {
      isValid: false,
      error: 'Skill instructions are required after the frontmatter.',
    };
  }

  return { isValid: true };
}

/**
 * Generate SKILL.md content from a skill object.
 * 
 * @param skill - The agent skill to generate markdown for
 * @returns Formatted SKILL.md content
 */
export function generateSkillMarkdown(skill: AgentSkill): string {
  return `---
name: ${skill.name}
description: ${skill.description}
---

${skill.instructions}
`;
}

/**
 * Generate a minimal SKILL.md template for creating new skills.
 * 
 * @param name - Optional skill name
 * @param description - Optional skill description
 * @returns Template SKILL.md content
 */
export function generateSkillTemplate(
  name?: string,
  description?: string
): string {
  return `---
name: ${name || 'your-skill-name'}
description: ${description || 'Brief description of what this skill does'}
---

# Your Skill Instructions

Describe what the skill does and how the agent should behave when this skill is active.

## Guidelines
- Include specific instructions for the agent
- Use markdown formatting for readability
- Keep instructions focused and actionable

## Examples

Provide examples of how the agent should behave:

\`\`\`
User: [input example]
Agent: [expected behavior]
\`\`\`
`;
}

/**
 * Create a new skill object from parsed markdown content.
 * 
 * @param content - The SKILL.md file content
 * @param options - Optional settings for the skill
 * @returns Complete AgentSkill object
 */
export function createSkillFromMarkdown(
  content: string,
  options?: {
    source?: AgentSkill['source'];
    filePath?: string;
    sourceDirectory?: string;
  }
): AgentSkill {
  const parsed = parseSkillMarkdown(content);

  if (!parsed) {
    throw new Error('Invalid SKILL.md format. Expected YAML frontmatter with "name" field.');
  }

  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    source: options?.source ?? 'local',
    filePath: options?.filePath,
    sourceDirectory: options?.sourceDirectory,
  };
}

/**
 * Check if a string appears to be a valid skill name.
 * 
 * @param name - The name to validate
 * @returns true if the name is valid
 */
export function isValidSkillName(name: string): boolean {
  // Skill names should be non-empty and reasonable length
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 100 && /^[a-zA-Z0-9_\-\s]+$/.test(trimmed);
}

/**
 * Extract skill name from a potential skill identifier.
 * Handles formats like "skill-name", "Skill Name", "skill_name", etc.
 * 
 * @param identifier - The identifier to normalize
 * @returns Normalized skill name
 */
export function normalizeSkillName(identifier: string): string {
  return identifier
    .trim()
    .replace(/[_\s]+/g, '-') // Replace underscores and spaces with hyphens
    .replace(/[^a-zA-Z0-9\-]/g, '') // Remove special characters
    .toLowerCase();
}

/**
 * Get default skills directory path for the platform.
 * 
 * @param appName - The application name (e.g., 'speakmcp')
 * @returns Platform-specific default skills directory
 */
export function getDefaultSkillsDirectory(appName: string = 'speakmcp'): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  
  if (process.platform === 'darwin') {
    return `${homeDir}/Library/Application Support/${appName}/skills`;
  } else if (process.platform === 'win32') {
    return `${process.env.APPDATA || homeDir}\\${appName}\\skills`;
  } else {
    return `${homeDir}/.config/${appName}/skills`;
  }
}
