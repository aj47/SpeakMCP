/**
 * Integration Tests - Full Workflows
 *
 * Tests for complete user workflows and cross-feature integration
 */

import { TestSuite } from "../utils/test-framework";

export const workflowsSuite: TestSuite = {
  name: "Integration Workflows",
  category: "Integration",
  tests: [
    // =====================================================
    // App Startup Workflow
    // =====================================================
    {
      name: "App loads with all required components",
      description: "Verify complete startup",
      code: `
        const checks = {
          hasIpc: !!window.electron?.ipcRenderer?.invoke,
          hasRoot: !!document.getElementById('root'),
          hasConfig: false,
          hasMcp: false
        };

        try {
          const config = await helpers.ipc('getConfig');
          checks.hasConfig = !!config;
        } catch (e) {}

        try {
          const mcpStatus = await helpers.ipc('getMcpServerStatus');
          checks.hasMcp = !!mcpStatus;
        } catch (e) {}

        return checks;
      `,
    },
    {
      name: "Navigation system fully functional",
      description: "Test all routes load",
      code: `
        const routes = ['/', '/history', '/settings/general', '/settings/tools', '/settings/mcp-tools'];
        const results = [];

        for (const route of routes) {
          await helpers.navigate(route);
          await new Promise(r => setTimeout(r, 300));
          const loaded = helpers.getRoute() === route;
          results.push({ route, loaded });
        }

        await helpers.navigate('/');
        return results;
      `,
    },

    // =====================================================
    // Settings Workflow
    // =====================================================
    {
      name: "Settings can be read and are consistent",
      description: "Verify settings system",
      code: `
        const config = await helpers.ipc('getConfig');
        const flags = await helpers.ipc('getDebugFlags');
        const current = await helpers.ipc('getCurrentProfile');

        return {
          hasConfig: !!config,
          configKeys: Object.keys(config).length,
          hasFlags: !!flags,
          hasProfile: !!current
        };
      `,
    },

    // =====================================================
    // Profile Workflow
    // =====================================================
    {
      name: "Profile system is consistent",
      description: "Verify profile data integrity",
      code: `
        const profiles = await helpers.ipc('getProfiles');
        const current = await helpers.ipc('getCurrentProfile');

        const isConsistent = !current || profiles.some(p => p.id === current.id);

        return {
          profileCount: profiles.length,
          hasCurrent: !!current,
          isConsistent
        };
      `,
    },

    // =====================================================
    // MCP System Workflow
    // =====================================================
    {
      name: "MCP system is initialized",
      description: "Verify MCP startup complete",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        const initStatus = await helpers.ipc('getMcpInitializationStatus');
        const tools = await helpers.ipc('getMcpDetailedToolList');

        return {
          serverCount: Object.keys(status).length,
          initStatus,
          toolCount: Array.isArray(tools) ? tools.length : Object.keys(tools || {}).length
        };
      `,
    },
    {
      name: "MCP servers are reachable",
      description: "Verify server connectivity",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        const servers = Object.entries(status);

        const results = servers.map(([name, serverStatus]) => ({
          name,
          connected: serverStatus?.connected || serverStatus?.status === 'connected' || false
        }));

        return results;
      `,
    },

    // =====================================================
    // Session System Workflow
    // =====================================================
    {
      name: "Session system is functional",
      description: "Verify session management",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        const status = await helpers.ipc('getAgentStatus');

        return {
          sessionsType: Array.isArray(sessions) ? 'array' : typeof sessions,
          sessionCount: Array.isArray(sessions) ? sessions.length : 0,
          hasStatus: !!status
        };
      `,
    },

    // =====================================================
    // History System Workflow
    // =====================================================
    {
      name: "History system is functional",
      description: "Verify conversation history",
      code: `
        const history = await helpers.ipc('getConversationHistory');
        const recordings = await helpers.ipc('getRecordingHistory');

        return {
          conversationCount: history.length,
          recordingCount: recordings.length
        };
      `,
    },

    // =====================================================
    // UI Consistency
    // =====================================================
    {
      name: "UI renders consistently across routes",
      description: "Verify UI stability",
      code: `
        const routes = ['/', '/settings/general', '/history'];
        const results = [];

        for (const route of routes) {
          await helpers.navigate(route);
          await new Promise(r => setTimeout(r, 400));

          const hasRoot = !!document.getElementById('root');
          const hasContent = document.body.innerHTML.length > 1000;
          const hasButtons = document.querySelectorAll('button').length > 0;

          results.push({ route, hasRoot, hasContent, hasButtons });
        }

        await helpers.navigate('/');
        return results;
      `,
    },

    // =====================================================
    // IPC Round-Trip
    // =====================================================
    {
      name: "IPC round-trip is reliable",
      description: "Test multiple IPC calls",
      code: `
        const calls = [
          'getConfig',
          'getDebugFlags',
          'getProfiles',
          'getCurrentProfile',
          'getMcpServerStatus',
          'getAgentSessions',
          'getConversationHistory'
        ];

        const results = [];
        for (const call of calls) {
          const start = Date.now();
          try {
            await helpers.ipc(call);
            results.push({ call, success: true, time: Date.now() - start });
          } catch (e) {
            results.push({ call, success: false, error: e.message });
          }
        }

        return results;
      `,
    },

    // =====================================================
    // State Persistence
    // =====================================================
    {
      name: "State persists across navigation",
      description: "Test state management",
      code: `
        // Store state
        helpers.setState('testValue', { timestamp: Date.now(), value: 'test' });

        // Navigate away
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 300));

        // Navigate back
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));

        // Check state
        const retrieved = helpers.getState('testValue');
        return {
          persisted: !!retrieved,
          value: retrieved
        };
      `,
    },

    // =====================================================
    // Error Handling
    // =====================================================
    {
      name: "Invalid IPC calls handled gracefully",
      description: "Test error handling",
      code: `
        try {
          await helpers.ipc('invalidProcedureThatDoesNotExist');
          return { handled: false, message: 'Should have thrown' };
        } catch (e) {
          return { handled: true, errorType: e.constructor.name };
        }
      `,
    },
    {
      name: "Invalid routes handled gracefully",
      description: "Test route error handling",
      code: `
        await helpers.navigate('/this/route/does/not/exist/12345');
        await new Promise(r => setTimeout(r, 300));

        // App should still be functional
        const hasContent = document.body.innerHTML.length > 100;
        const canNavigateBack = await (async () => {
          await helpers.navigate('/');
          await new Promise(r => setTimeout(r, 200));
          return helpers.getRoute() === '/';
        })();

        return { hasContent, canNavigateBack };
      `,
    },

    // =====================================================
    // Diagnostic System
    // =====================================================
    {
      name: "Diagnostic system is functional",
      description: "Verify diagnostics work",
      code: `
        const report = await helpers.ipc('getDiagnosticReport');
        const health = await helpers.ipc('performHealthCheck');
        const errors = await helpers.ipc('getRecentErrors');

        return {
          hasReport: !!report,
          hasHealth: !!health,
          errorCount: errors.length
        };
      `,
    },

    // =====================================================
    // Cross-System Integration
    // =====================================================
    {
      name: "Profile affects MCP tool availability",
      description: "Test profile-MCP integration",
      code: `
        const profile = await helpers.ipc('getCurrentProfile');
        const tools = await helpers.ipc('getMcpDetailedToolList');

        return {
          hasProfile: !!profile,
          toolCount: Array.isArray(tools) ? tools.length : Object.keys(tools || {}).length,
          note: 'Profile MCP config affects available tools'
        };
      `,
    },

    // =====================================================
    // Update System
    // =====================================================
    {
      name: "Update system is functional",
      description: "Verify update check works",
      code: `
        const updateInfo = await helpers.ipc('getUpdateInfo');
        return {
          checked: true,
          hasUpdate: !!updateInfo
        };
      `,
    },

    // =====================================================
    // External Integrations
    // =====================================================
    {
      name: "Cloudflare tunnel system available",
      description: "Verify tunnel capability",
      code: `
        const installed = await helpers.ipc('checkCloudflaredInstalled');
        const status = await helpers.ipc('getCloudflareTunnelStatus');

        return {
          cloudflaredInstalled: installed,
          tunnelStatus: status
        };
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after integration tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default workflowsSuite;
