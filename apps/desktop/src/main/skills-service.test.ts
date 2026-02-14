import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import path from "path"
import fs from "fs"
import { AgentSkill } from "@shared/types"
import { skillsService } from "./skills-service"

// Test data
const validSkillMarkdown = `---
name: test-skill
description: A test skill for unit testing
---

Your instructions here. This is the skill content.
`

const validSkillMarkdownNoDescription = `---
name: another-skill
---

Instructions without description.
`

const invalidSkillMarkdownNoFrontmatter = `name: test-skill
description: A test skill
---

Instructions.`

const invalidSkillMarkdownNoName = `---
description: A test skill without name
---

Instructions.`

describe("SkillsService", () => {
  describe("createSkill", () => {
    it("should create a skill with valid input", () => {
      const skill = skillsService.createSkill(
        "test-skill",
        "A test skill",
        "Instructions here."
      )

      expect(skill).toBeDefined()
      expect(skill.id).toBeDefined()
      expect(skill.name).toBe("test-skill")
      expect(skill.description).toBe("A test skill")
      expect(skill.instructions).toBe("Instructions here.")
      expect(skill.enabled).toBe(true)
      expect(skill.source).toBe("local")
      expect(skill.createdAt).toBeDefined()
      expect(skill.updatedAt).toBeDefined()
    })

    it("should create skill with imported source when specified", () => {
      const skill = skillsService.createSkill(
        "imported-skill",
        "An imported skill",
        "Imported instructions.",
        { source: "imported", filePath: "/path/to/skill" }
      )

      expect(skill.source).toBe("imported")
      expect(skill.filePath).toBe("/path/to/skill")
    })
  })

  describe("getSkills", () => {
    it("should return all skills", () => {
      const skills = skillsService.getSkills()
      expect(Array.isArray(skills)).toBe(true)
    })

    it("should return only enabled skills with getEnabledSkills", () => {
      const enabledSkills = skillsService.getEnabledSkills()
      expect(enabledSkills.every(s => s.enabled)).toBe(true)
    })
  })

  describe("getSkill", () => {
    it("should return undefined for non-existent skill", () => {
      const skill = skillsService.getSkill("non-existent-id")
      expect(skill).toBeUndefined()
    })
  })

  describe("updateSkill", () => {
    it("should update skill fields", () => {
      // Create a skill first
      const created = skillsService.createSkill(
        "update-test-skill",
        "Original description",
        "Original instructions."
      )

      // Update it
      const updated = skillsService.updateSkill(created.id, {
        name: "updated-name",
        description: "Updated description",
        instructions: "Updated instructions.",
        enabled: false,
      })

      expect(updated.name).toBe("updated-name")
      expect(updated.description).toBe("Updated description")
      expect(updated.instructions).toBe("Updated instructions.")
      expect(updated.enabled).toBe(false)
      expect(updated.id).toBe(created.id)
    })

    it("should throw error for non-existent skill", () => {
      expect(() => {
        skillsService.updateSkill("non-existent-id", { name: "test" })
      }).toThrow("Skill with id non-existent-id not found")
    })
  })

  describe("deleteSkill", () => {
    it("should return false for non-existent skill", () => {
      const result = skillsService.deleteSkill("non-existent-id")
      expect(result).toBe(false)
    })

    it("should delete existing skill", () => {
      const created = skillsService.createSkill(
        "delete-test-skill",
        "Skill to delete",
        "Delete these instructions."
      )

      const result = skillsService.deleteSkill(created.id)
      expect(result).toBe(true)

      const retrieved = skillsService.getSkill(created.id)
      expect(retrieved).toBeUndefined()
    })
  })

  describe("importSkillFromMarkdown", () => {
    it("should import skill from valid markdown", () => {
      const skill = skillsService.importSkillFromMarkdown(validSkillMarkdown)

      expect(skill).toBeDefined()
      expect(skill.name).toBe("test-skill")
      expect(skill.description).toBe("A test skill for unit testing")
      expect(skill.instructions).toContain("Your instructions here")
      expect(skill.enabled).toBe(true)
      expect(skill.source).toBe("imported")
    })

    it("should import skill without description", () => {
      const skill = skillsService.importSkillFromMarkdown(validSkillMarkdownNoDescription)

      expect(skill).toBeDefined()
      expect(skill.name).toBe("another-skill")
      expect(skill.description).toBe("")
      expect(skill.instructions).toContain("Instructions without description")
    })

    it("should return null for invalid markdown (no frontmatter)", () => {
      const result = skillsService.importSkillFromMarkdown(invalidSkillMarkdownNoFrontmatter)
      expect(result).toBeNull()
    })

    it("should return null for invalid markdown (no name)", () => {
      const result = skillsService.importSkillFromMarkdown(invalidSkillMarkdownNoName)
      expect(result).toBeNull()
    })
  })

  describe("exportSkillToMarkdown", () => {
    it("should export skill to valid markdown format", () => {
      const created = skillsService.createSkill(
        "export-test-skill",
        "Skill for export testing",
        "These are the export instructions."
      )

      const markdown = skillsService.exportSkillToMarkdown(created.id)

      expect(markdown).toBeDefined()
      expect(markdown).toContain("name: export-test-skill")
      expect(markdown).toContain("description: Skill for export testing")
      expect(markdown).toContain("These are the export instructions")
      expect(markdown).toMatch(/^---\n/)
      expect(markdown).toMatch(/\n---\n/)
    })

    it("should return null for non-existent skill", () => {
      const result = skillsService.exportSkillToMarkdown("non-existent-id")
      expect(result).toBeNull()
    })
  })
})

describe("parseSkillMarkdown helper", () => {
  // These tests verify the internal parsing behavior through importSkillFromMarkdown
  // since parseSkillMarkdown is a private helper function

  it("should handle CRLF line endings", () => {
    const crlfMarkdown = `---\r\nname: crlf-skill\r\ndescription: Skill with Windows line endings\r\n---\r\nInstructions.\r\n`
    const skill = skillsService.importSkillFromMarkdown(crlfMarkdown)
    expect(skill).toBeDefined()
    expect(skill?.name).toBe("crlf-skill")
  })

  it("should handle LF line endings", () => {
    const lfMarkdown = `---\nname: lf-skill\ndescription: Skill with Unix line endings\n---\nInstructions.\n`
    const skill = skillsService.importSkillFromMarkdown(lfMarkdown)
    expect(skill).toBeDefined()
    expect(skill?.name).toBe("lf-skill")
  })

  it("should trim whitespace from name and description", () => {
    const whitespaceMarkdown = `---\nname:  whitespace-skill  \ndescription:  Extra spaces  \n---\nInstructions.\n`
    const skill = skillsService.importSkillFromMarkdown(whitespaceMarkdown)
    expect(skill).toBeDefined()
    expect(skill?.name).toBe("whitespace-skill")
    expect(skill?.description).toBe("Extra spaces")
  })
})

describe("generateSkillMarkdown helper", () => {
  // These tests verify the internal generation behavior through exportSkillToMarkdown

  it("should generate valid frontmatter format", () => {
    const created = skillsService.createSkill(
      "format-test-skill",
      "Testing markdown format",
      "Format test instructions."
    )

    const markdown = skillsService.exportSkillToMarkdown(created.id)

    // Verify frontmatter is present
    expect(markdown).toMatch(/^---\nname: format-test-skill\n/)
    expect(markdown).toContain("description: Testing markdown format\n")
    expect(markdown).toMatch(/\n---\n/)
    
    // Verify instructions come after frontmatter
    const frontmatterEnd = markdown.indexOf("---\n", 4)
    expect(frontmatterEnd).toBeGreaterThan(-1)
    expect(markdown.substring(frontmatterEnd + 5)).toContain("Format test instructions.")
  })
})
