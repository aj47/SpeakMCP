---
name: agent-skill-creation
description: "Teaches the agent how to create new Agent Skills - the open standard for extending AI agent capabilities. Use this skill when asked to create, write, or develop new skills for AI agents."
---

# Agent Skill Creation Guide

This skill teaches you how to create Agent Skills following Anthropic's open standard (agentskills.io).

## What is an Agent Skill?

An Agent Skill is a folder containing a `SKILL.md` file with:
- YAML frontmatter (name and description)
- Markdown instructions that give agents specialized knowledge and workflows
- Optional supporting files (scripts, reference docs, templates)

## SKILL.md Format

```markdown
---
name: skill-name-in-kebab-case
description: "Concise description of what this skill enables. Include trigger phrases like 'When the user asks to...'"
---

# Skill Title

## Overview
Brief explanation of what this skill does and when to use it.

## Workflows
Step-by-step instructions for completing tasks.

## Best Practices
Guidelines and tips for using this skill effectively.

## Dependencies (optional)
Required tools or packages.
```

## Design Principles

### 1. Progressive Disclosure
- Load only what's needed: name/description first, then full instructions
- Split large skills into multiple files referenced from SKILL.md
- Use separate files for detailed reference material

### 2. Clear Trigger Conditions
- The description should clearly indicate WHEN to use this skill
- Include example phrases: "When the user asks to...", "For tasks involving..."

### 3. Actionable Instructions
- Write step-by-step workflows, not just explanations
- Include code examples, commands, and templates
- Be specific about tools and parameters to use

### 4. Think from Claude's Perspective
- What context does the agent need to succeed?
- What mistakes might it make? Include warnings
- What's the decision tree for different scenarios?

## Creating a New Skill

### Step 1: Plan the Skill
Answer these questions:
1. What specific capability does this skill provide?
2. What triggers should activate this skill?
3. What steps/workflows are involved?
4. What could go wrong? What guardrails are needed?

### Step 2: Create the Skill Folder
```bash
# Use the absolute skills installation path
# The path varies by OS - use the path shown in the skills system prompt
mkdir -p "<SKILLS_FOLDER>/my-skill-name"
```

### Step 3: Write SKILL.md
Create the SKILL.md file with:
- Frontmatter with name and description
- Overview section
- Workflow sections with step-by-step instructions
- Examples and code snippets

### Step 4: Add Supporting Files (Optional)
For complex skills, create additional files:
- `reference.md` - Detailed documentation
- `templates/` - Template files for common tasks
- `scripts/` - Helper scripts the agent can execute

### Step 5: Skill is Auto-Imported
Skills are automatically detected when you save the SKILL.md file - no restart needed!
The app watches the skills folder and auto-imports new skills in real-time.
New skills are auto-enabled by default.

### Step 6: Test the Skill
- Check Settings > Skills to verify it appears
- Ask questions that should trigger it
- Iterate based on what works and what doesn't

## Example Skills Ideas

- **Code Review**: Guidelines for reviewing code in a specific language or framework
- **API Integration**: Instructions for working with a specific API
- **Testing Patterns**: Best practices for writing tests in your stack
- **Documentation**: Standards for writing technical documentation
- **Git Workflows**: Team-specific branching and commit conventions
- **Data Processing**: Workflows for handling specific data formats

## Best Practices for Skill Authors

1. **Start with evaluation**: Identify where your agent struggles before writing a skill
2. **Structure for scale**: Keep SKILL.md lean, use linked files for detailed content
3. **Iterate with Claude**: Ask the agent to help refine the skill based on real usage
4. **Version control**: Put skills in git for team sharing and history
5. **Security**: Only install skills from trusted sources; audit third-party skills

## File Organization

```
skill-name/
├── SKILL.md           # Required: Main skill instructions
├── reference.md       # Optional: Detailed reference material
├── examples/          # Optional: Example files
│   ├── example1.md
│   └── example2.md
├── scripts/           # Optional: Helper scripts
│   └── helper.py
└── templates/         # Optional: Templates for common tasks
    └── template.md
```

## Common Mistakes to Avoid

1. **Too broad**: Skills work best when focused on specific tasks
2. **Too much context**: Don't load everything upfront; use progressive disclosure
3. **Missing examples**: Always include concrete examples and code
4. **Vague triggers**: Make it clear exactly when to use the skill
5. **No error handling**: Include guidance for common failure modes

