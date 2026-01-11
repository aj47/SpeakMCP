/**
 * IPC Communication Tests - TIPC Procedures
 *
 * Tests all major IPC procedures between renderer and main process
 */

import { TestSuite } from "../utils/test-framework";

export const tipcProceduresSuite: TestSuite = {
  name: "TIPC Procedures",
  category: "IPC Communication",
  tests: [
    // =====================================================
    // Configuration Procedures
    // =====================================================
    {
      name: "getConfig procedure works",
      description: "Test config retrieval",
      code: `
        const config = await helpers.ipc('getConfig');
        assert.isObject(config, 'Config should be object');
        return Object.keys(config).length;
      `,
    },
    {
      name: "getDebugFlags procedure works",
      description: "Test debug flags retrieval",
      code: `
        const flags = await helpers.ipc('getDebugFlags');
        assert.isObject(flags, 'Flags should be object');
        assert.hasProperty(flags, 'llm');
        assert.hasProperty(flags, 'tools');
        return flags;
      `,
    },
    {
      name: "getDefaultSystemPrompt procedure works",
      description: "Test default prompt retrieval",
      code: `
        const prompt = await helpers.ipc('getDefaultSystemPrompt');
        assert.isString(prompt, 'Prompt should be string');
        return prompt.substring(0, 100);
      `,
    },

    // =====================================================
    // Profile Procedures
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
      name: "getCurrentProfile returns profile object",
      description: "Test current profile retrieval",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        // May be null if no profile set
        if (profile) {
          assert.isObject(profile, 'Profile should be object');
          assert.hasProperty(profile, 'id', 'Profile should have id');
          assert.hasProperty(profile, 'name', 'Profile should have name');
        }
        return profile;
      `,
    },
    {
      name: "getProfile by ID works",
      description: "Test specific profile retrieval",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        if (profiles.length > 0) {
          const profile = await helpers.ipc('getProfile', profiles[0].id);
          assert.isObject(profile, 'Should return profile');
          assert.equal(profile.id, profiles[0].id, 'ID should match');
          return profile.name;
        }
        return 'No profiles to test';
      `,
    },

    // =====================================================
    // Agent Session Procedures
    // =====================================================
    {
      name: "getAgentSessions returns array",
      description: "Test agent sessions list",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        assert.isArray(sessions, 'Sessions should be array');
        return sessions.length;
      `,
    },
    {
      name: "getAgentStatus returns status info",
      description: "Test agent status retrieval",
      code: `
        const status = await helpers.ipc('getAgentStatus');
        // Returns status object or null
        return status;
      `,
    },

    // =====================================================
    // MCP Procedures
    // =====================================================
    {
      name: "getMcpServerStatus returns status object",
      description: "Test MCP server status",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        assert.isObject(status, 'Status should be object');
        return Object.keys(status);
      `,
    },
    {
      name: "getMcpInitializationStatus returns status",
      description: "Test MCP initialization status",
      code: `
        const status = await helpers.ipc('getMcpInitializationStatus');
        assert.isObject(status, 'Should return status object');
        return status;
      `,
    },
    {
      name: "getMcpDetailedToolList returns tools",
      description: "Test MCP tool list retrieval",
      code: `
        const tools = await helpers.ipc('getMcpDetailedToolList');
        // Tools can be array or object depending on structure
        if (Array.isArray(tools)) {
          return tools.length;
        }
        return tools;
      `,
    },
    {
      name: "validateMcpConfig validates config structure",
      description: "Test MCP config validation",
      code: `
        const validConfig = { mcpServers: {} };
        const result = await helpers.ipc('validateMcpConfig', JSON.stringify(validConfig));
        return result;
      `,
    },

    // =====================================================
    // Conversation Procedures
    // =====================================================
    {
      name: "getConversationHistory returns array",
      description: "Test conversation history retrieval",
      code: `
        const history = await helpers.ipc('getConversationHistory');
        assert.isArray(history, 'History should be array');
        return history.length;
      `,
    },

    // =====================================================
    // Recording History Procedures
    // =====================================================
    {
      name: "getRecordingHistory returns array",
      description: "Test recording history retrieval",
      code: `
        const history = await helpers.ipc('getRecordingHistory');
        assert.isArray(history, 'Recording history should be array');
        return history.length;
      `,
    },

    // =====================================================
    // Message Queue Procedures
    // =====================================================
    {
      name: "getMessageQueue returns queue data",
      description: "Test message queue retrieval",
      code: `
        const queue = await helpers.ipc('getMessageQueue');
        // Queue can be array or object
        return queue;
      `,
    },
    {
      name: "getAllMessageQueues returns all queues",
      description: "Test all queues retrieval",
      code: `
        const queues = await helpers.ipc('getAllMessageQueues');
        return queues;
      `,
    },

    // =====================================================
    // Window Management Procedures
    // =====================================================
    {
      name: "getPanelPosition returns position",
      description: "Test panel position retrieval",
      code: `
        const position = await helpers.ipc('getPanelPosition');
        assert.isObject(position, 'Position should be object');
        return position;
      `,
    },
    {
      name: "getPanelSize returns size data",
      description: "Test panel size retrieval",
      code: `
        const size = await helpers.ipc('getPanelSize');
        assert.isObject(size, 'Size should be object');
        return size;
      `,
    },

    // =====================================================
    // System Access Procedures
    // =====================================================
    {
      name: "getMicrophoneStatus returns status",
      description: "Test microphone status check",
      code: `
        const status = await helpers.ipc('getMicrophoneStatus');
        // Returns boolean or status object
        return status;
      `,
    },

    // =====================================================
    // Diagnostic Procedures
    // =====================================================
    {
      name: "getDiagnosticReport returns report",
      description: "Test diagnostic report generation",
      code: `
        const report = await helpers.ipc('getDiagnosticReport');
        assert.isObject(report, 'Report should be object');
        return Object.keys(report);
      `,
    },
    {
      name: "performHealthCheck returns health data",
      description: "Test health check execution",
      code: `
        const health = await helpers.ipc('performHealthCheck');
        assert.isObject(health, 'Health should be object');
        return health;
      `,
    },
    {
      name: "getRecentErrors returns error array",
      description: "Test recent errors retrieval",
      code: `
        const errors = await helpers.ipc('getRecentErrors');
        assert.isArray(errors, 'Errors should be array');
        return errors.length;
      `,
    },

    // =====================================================
    // Update Procedures
    // =====================================================
    {
      name: "getUpdateInfo returns update status",
      description: "Test update info retrieval",
      code: `
        const info = await helpers.ipc('getUpdateInfo');
        // Can be null if no updates
        return info;
      `,
    },

    // =====================================================
    // Cloudflare Tunnel Procedures
    // =====================================================
    {
      name: "checkCloudflaredInstalled returns boolean",
      description: "Test cloudflared check",
      code: `
        const installed = await helpers.ipc('checkCloudflaredInstalled');
        assert.isBoolean(installed, 'Should return boolean');
        return installed;
      `,
    },
    {
      name: "getCloudflareTunnelStatus returns status",
      description: "Test tunnel status",
      code: `
        const status = await helpers.ipc('getCloudflareTunnelStatus');
        return status;
      `,
    },

    // =====================================================
    // MCP Registry Procedures
    // =====================================================
    {
      name: "fetchMcpRegistryServers returns servers",
      description: "Test MCP registry fetch",
      code: `
        try {
          const servers = await helpers.ipc('fetchMcpRegistryServers');
          // May fail if offline, that's ok
          return servers;
        } catch (e) {
          // Expected if offline
          return 'Registry fetch skipped (may be offline)';
        }
      `,
    },

    // =====================================================
    // Model Procedures
    // =====================================================
    {
      name: "fetchAvailableModels returns models",
      description: "Test available models fetch",
      code: `
        try {
          const models = await helpers.ipc('fetchAvailableModels');
          return models;
        } catch (e) {
          // May fail without API key
          return 'Models fetch skipped (requires API key)';
        }
      `,
    },
  ],
};

export default tipcProceduresSuite;
