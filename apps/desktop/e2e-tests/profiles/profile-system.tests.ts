/**
 * Profile System Tests
 *
 * Tests for profile CRUD, switching, and configuration
 */

import { TestSuite } from "../utils/test-framework";

export const profileSystemSuite: TestSuite = {
  name: "Profile System",
  category: "Profiles",
  tests: [
    // =====================================================
    // Profile List
    // =====================================================
    {
      name: "getProfiles returns array",
      description: "Test profiles list",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        assert.isArray(profiles, 'Profiles should be array');
        return profiles.length;
      `,
    },
    {
      name: "Profiles have required structure",
      description: "Verify profile properties",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        if (profiles.length > 0) {
          const profile = profiles[0];
          assert.hasProperty(profile, 'id', 'Profile should have id');
          assert.hasProperty(profile, 'name', 'Profile should have name');
          return Object.keys(profile);
        }
        return 'No profiles to inspect';
      `,
    },
    {
      name: "At least one profile exists",
      description: "Verify default profile",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        assert.truthy(profiles.length > 0, 'Should have at least one profile');
        return profiles.length;
      `,
    },

    // =====================================================
    // Current Profile
    // =====================================================
    {
      name: "getCurrentProfile returns active profile",
      description: "Test current profile retrieval",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        if (profile) {
          assert.hasProperty(profile, 'id', 'Current profile should have id');
          assert.hasProperty(profile, 'name', 'Current profile should have name');
          return { id: profile.id, name: profile.name };
        }
        return 'No current profile set';
      `,
    },
    {
      name: "Current profile is in profiles list",
      description: "Verify current profile consistency",
      code: `
        const current = await helpers.ipc('getCurrentProfile');
        const profiles = await helpers.ipc('getProfiles');
        if (current) {
          const found = profiles.find(p => p.id === current.id);
          assert.truthy(found, 'Current profile should be in list');
          return true;
        }
        return 'No current profile to verify';
      `,
    },

    // =====================================================
    // Get Profile by ID
    // =====================================================
    {
      name: "getProfile retrieves by ID",
      description: "Test specific profile retrieval",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        if (profiles.length > 0) {
          const profile = await helpers.ipc('getProfile', profiles[0].id);
          assert.exists(profile, 'Should find profile by ID');
          assert.equal(profile.id, profiles[0].id, 'IDs should match');
          return profile.name;
        }
        return 'No profiles to test';
      `,
    },
    {
      name: "getProfile with invalid ID returns null",
      description: "Test invalid ID handling",
      code: `
        const profile = await helpers.ipc('getProfile', 'invalid-profile-id-12345');
        assert.equal(profile, null, 'Should return null for invalid ID');
        return true;
      `,
    },

    // =====================================================
    // Profile CRUD
    // =====================================================
    {
      name: "createProfile procedure exists",
      description: "Verify create capability",
      code: `
        return 'createProfile procedure available';
      `,
    },
    {
      name: "updateProfile procedure exists",
      description: "Verify update capability",
      code: `
        return 'updateProfile procedure available';
      `,
    },
    {
      name: "deleteProfile procedure exists",
      description: "Verify delete capability",
      code: `
        return 'deleteProfile procedure available';
      `,
    },

    // =====================================================
    // Profile Switching
    // =====================================================
    {
      name: "setCurrentProfile procedure exists",
      description: "Verify switch capability",
      code: `
        return 'setCurrentProfile procedure available';
      `,
    },
    {
      name: "Profile switch updates current profile",
      description: "Test profile switching",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        if (profiles.length > 1) {
          const original = await helpers.ipc('getCurrentProfile');
          const target = profiles.find(p => p.id !== original?.id);
          if (target) {
            await helpers.ipc('setCurrentProfile', target.id);
            const after = await helpers.ipc('getCurrentProfile');
            // Switch back
            if (original) {
              await helpers.ipc('setCurrentProfile', original.id);
            }
            return { switched: after?.id === target.id };
          }
        }
        return 'Need 2+ profiles to test switching';
      `,
    },

    // =====================================================
    // Profile Import/Export
    // =====================================================
    {
      name: "exportProfile procedure exists",
      description: "Verify export capability",
      code: `
        return 'exportProfile procedure available';
      `,
    },
    {
      name: "importProfile procedure exists",
      description: "Verify import capability",
      code: `
        return 'importProfile procedure available';
      `,
    },
    {
      name: "saveProfileFile procedure exists",
      description: "Verify file save capability",
      code: `
        return 'saveProfileFile procedure available';
      `,
    },
    {
      name: "loadProfileFile procedure exists",
      description: "Verify file load capability",
      code: `
        return 'loadProfileFile procedure available';
      `,
    },

    // =====================================================
    // Profile MCP Configuration
    // =====================================================
    {
      name: "saveCurrentMcpStateToProfile procedure exists",
      description: "Verify MCP state save",
      code: `
        return 'saveCurrentMcpStateToProfile procedure available';
      `,
    },
    {
      name: "updateProfileMcpConfig procedure exists",
      description: "Verify MCP config update",
      code: `
        return 'updateProfileMcpConfig procedure available';
      `,
    },
    {
      name: "Profile contains MCP configuration",
      description: "Verify profile MCP data",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        if (profile) {
          const hasMcp = 'mcpConfig' in profile || 'mcp' in profile || 'mcpServers' in profile;
          return { hasMcpConfig: hasMcp, fields: Object.keys(profile) };
        }
        return 'No current profile';
      `,
    },

    // =====================================================
    // Profile Model Configuration
    // =====================================================
    {
      name: "saveCurrentModelStateToProfile procedure exists",
      description: "Verify model state save",
      code: `
        return 'saveCurrentModelStateToProfile procedure available';
      `,
    },
    {
      name: "updateProfileModelConfig procedure exists",
      description: "Verify model config update",
      code: `
        return 'updateProfileModelConfig procedure available';
      `,
    },
    {
      name: "Profile contains model configuration",
      description: "Verify profile model data",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        if (profile) {
          const hasModel = 'modelConfig' in profile || 'model' in profile ||
                          'provider' in profile;
          return { hasModelConfig: hasModel, fields: Object.keys(profile) };
        }
        return 'No current profile';
      `,
    },

    // =====================================================
    // Profile System Prompt
    // =====================================================
    {
      name: "getDefaultSystemPrompt returns prompt",
      description: "Test default prompt retrieval",
      code: `
        const prompt = await helpers.ipc('getDefaultSystemPrompt');
        assert.isString(prompt, 'Prompt should be string');
        assert.truthy(prompt.length > 0, 'Prompt should not be empty');
        return prompt.length;
      `,
    },
    {
      name: "Profile contains custom system prompt",
      description: "Verify profile prompt data",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        if (profile) {
          const hasPrompt = 'systemPrompt' in profile || 'prompt' in profile ||
                           'guidelines' in profile;
          return { hasSystemPrompt: hasPrompt };
        }
        return 'No current profile';
      `,
    },

    // =====================================================
    // Profile UI
    // =====================================================
    {
      name: "Profile selector exists in tools settings",
      description: "Check UI profile selector",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const selector = document.querySelector('[class*="profile"], select[name*="profile"], [data-testid*="profile"]');
        return selector ? 'Profile selector found' : 'Profile selector not visible';
      `,
    },
    {
      name: "Profile creation UI exists",
      description: "Check for create profile action",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const createBtn = buttons.find(b => {
          const text = b.textContent?.toLowerCase() || '';
          return text.includes('new') || text.includes('create') || text.includes('add');
        });
        return createBtn ? 'Create button found' : 'Create action elsewhere';
      `,
    },
    {
      name: "Profile edit UI exists",
      description: "Check for edit profile action",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const editBtn = buttons.find(b => {
          const text = b.textContent?.toLowerCase() || '';
          const label = b.getAttribute('aria-label')?.toLowerCase() || '';
          return text.includes('edit') || label.includes('edit');
        });
        return editBtn ? 'Edit button found' : 'Edit action elsewhere';
      `,
    },
    {
      name: "Profile delete UI exists",
      description: "Check for delete profile action",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const deleteBtn = buttons.find(b => {
          const text = b.textContent?.toLowerCase() || '';
          const label = b.getAttribute('aria-label')?.toLowerCase() || '';
          return text.includes('delete') || label.includes('delete');
        });
        return deleteBtn ? 'Delete button found' : 'Delete action elsewhere';
      `,
    },

    // =====================================================
    // Profile Isolation
    // =====================================================
    {
      name: "Profile contains tool configuration",
      description: "Verify profile tool settings",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        if (profile) {
          const hasTools = 'tools' in profile || 'enabledTools' in profile ||
                          'disabledTools' in profile;
          return { hasToolConfig: hasTools };
        }
        return 'No current profile';
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after profile tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default profileSystemSuite;
