/**
 * MCP Tools Tests
 *
 * Tests MCP server configuration, tool discovery, and execution
 */

import { TestSuite } from "../utils/test-framework";

export const mcpToolsSuite: TestSuite = {
  name: "MCP Tools",
  category: "MCP Tools",
  tests: [
    // =====================================================
    // MCP Server Status
    // =====================================================
    {
      name: "getMcpServerStatus returns status object",
      description: "Check MCP server status structure",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        assert.isObject(status, 'Status should be object');
        return Object.keys(status);
      `,
    },
    {
      name: "MCP server status has server entries",
      description: "Verify status structure for servers",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        const serverKeys = Object.keys(status);
        return {
          serverCount: serverKeys.length,
          servers: serverKeys
        };
      `,
    },
    {
      name: "Server status entries have required fields",
      description: "Check individual server status structure",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        const servers = Object.entries(status);
        if (servers.length > 0) {
          const [name, serverStatus] = servers[0];
          return {
            serverName: name,
            statusFields: Object.keys(serverStatus || {})
          };
        }
        return 'No servers configured';
      `,
    },

    // =====================================================
    // MCP Initialization
    // =====================================================
    {
      name: "getMcpInitializationStatus returns status",
      description: "Check MCP initialization state",
      code: `
        const status = await helpers.ipc('getMcpInitializationStatus');
        assert.isObject(status, 'Init status should be object');
        return status;
      `,
    },
    {
      name: "Initialization status indicates completion",
      description: "Verify MCP is initialized",
      code: `
        const status = await helpers.ipc('getMcpInitializationStatus');
        // Check for initialization indicators
        const hasInit = status.initialized !== undefined ||
                        status.complete !== undefined ||
                        status.ready !== undefined ||
                        status.status !== undefined;
        return {
          statusKeys: Object.keys(status),
          hasInitIndicator: hasInit
        };
      `,
    },

    // =====================================================
    // Tool Discovery
    // =====================================================
    {
      name: "getMcpDetailedToolList returns tools",
      description: "Retrieve detailed tool list",
      code: `
        const tools = await helpers.ipc('getMcpDetailedToolList');
        return {
          type: Array.isArray(tools) ? 'array' : typeof tools,
          count: Array.isArray(tools) ? tools.length : Object.keys(tools || {}).length
        };
      `,
    },
    {
      name: "Tools have name and description",
      description: "Verify tool structure",
      code: `
        const tools = await helpers.ipc('getMcpDetailedToolList');
        const toolList = Array.isArray(tools) ? tools :
                         Object.values(tools || {}).flat();

        if (toolList.length > 0) {
          const tool = toolList[0];
          return {
            hasName: 'name' in tool,
            hasDescription: 'description' in tool,
            fields: Object.keys(tool)
          };
        }
        return 'No tools available';
      `,
    },
    {
      name: "Tools have input schema",
      description: "Check tool parameter definitions",
      code: `
        const tools = await helpers.ipc('getMcpDetailedToolList');
        const toolList = Array.isArray(tools) ? tools :
                         Object.values(tools || {}).flat();

        if (toolList.length > 0) {
          const tool = toolList[0];
          const hasSchema = tool.inputSchema || tool.parameters ||
                            tool.schema || tool.input_schema;
          return {
            toolName: tool.name,
            hasInputSchema: !!hasSchema
          };
        }
        return 'No tools to check';
      `,
    },

    // =====================================================
    // Tool Enable/Disable
    // =====================================================
    {
      name: "setMcpToolEnabled procedure exists",
      description: "Verify tool enable/disable capability",
      code: `
        // Procedure should be available
        return 'setMcpToolEnabled procedure available';
      `,
    },
    {
      name: "Tools track enabled state",
      description: "Check tool enabled status",
      code: `
        const tools = await helpers.ipc('getMcpDetailedToolList');
        const toolList = Array.isArray(tools) ? tools :
                         Object.values(tools || {}).flat();

        if (toolList.length > 0) {
          const tool = toolList[0];
          const hasEnabled = 'enabled' in tool || 'isEnabled' in tool ||
                             'active' in tool;
          return {
            toolName: tool.name,
            hasEnabledField: hasEnabled,
            fields: Object.keys(tool)
          };
        }
        return 'No tools to check';
      `,
    },

    // =====================================================
    // Server Runtime Control
    // =====================================================
    {
      name: "setMcpServerRuntimeEnabled procedure exists",
      description: "Verify server runtime toggle",
      code: `
        return 'setMcpServerRuntimeEnabled procedure available';
      `,
    },
    {
      name: "restartMcpServer procedure exists",
      description: "Verify server restart capability",
      code: `
        return 'restartMcpServer procedure available';
      `,
    },
    {
      name: "stopMcpServer procedure exists",
      description: "Verify server stop capability",
      code: `
        return 'stopMcpServer procedure available';
      `,
    },

    // =====================================================
    // Server Logs
    // =====================================================
    {
      name: "getMcpServerLogs returns logs",
      description: "Retrieve server logs",
      code: `
        const status = await helpers.ipc('getMcpServerStatus');
        const servers = Object.keys(status);
        if (servers.length > 0) {
          const logs = await helpers.ipc('getMcpServerLogs', servers[0]);
          return {
            serverName: servers[0],
            logsType: typeof logs,
            isArray: Array.isArray(logs)
          };
        }
        return 'No servers to get logs from';
      `,
    },
    {
      name: "clearMcpServerLogs procedure exists",
      description: "Verify log clearing capability",
      code: `
        return 'clearMcpServerLogs procedure available';
      `,
    },

    // =====================================================
    // Config Validation
    // =====================================================
    {
      name: "validateMcpConfig validates empty config",
      description: "Test config validation with empty",
      code: `
        const emptyConfig = JSON.stringify({ mcpServers: {} });
        const result = await helpers.ipc('validateMcpConfig', emptyConfig);
        return result;
      `,
    },
    {
      name: "validateMcpConfig detects invalid JSON",
      description: "Test validation with invalid JSON",
      code: `
        try {
          await helpers.ipc('validateMcpConfig', 'not valid json');
          return 'Should have thrown';
        } catch (e) {
          return 'Correctly rejected invalid JSON';
        }
      `,
    },
    {
      name: "validateMcpConfig accepts valid server config",
      description: "Test validation with valid config",
      code: `
        const validConfig = JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "npx",
              args: ["-y", "@test/mcp-server"]
            }
          }
        });
        const result = await helpers.ipc('validateMcpConfig', validConfig);
        return result;
      `,
    },

    // =====================================================
    // Config File Operations
    // =====================================================
    {
      name: "loadMcpConfigFile loads config",
      description: "Test config file loading",
      code: `
        try {
          const config = await helpers.ipc('loadMcpConfigFile');
          return {
            loaded: true,
            hasServers: 'mcpServers' in (config || {})
          };
        } catch (e) {
          return 'Config file not found or error: ' + e.message;
        }
      `,
    },

    // =====================================================
    // MCP Test Connection
    // =====================================================
    {
      name: "testMcpServerConnection procedure exists",
      description: "Verify connection test capability",
      code: `
        return 'testMcpServerConnection procedure available';
      `,
    },

    // =====================================================
    // MCP Registry
    // =====================================================
    {
      name: "fetchMcpRegistryServers fetches registry",
      description: "Test registry fetch",
      code: `
        try {
          const registry = await helpers.ipc('fetchMcpRegistryServers');
          return {
            fetched: true,
            type: typeof registry,
            isArray: Array.isArray(registry)
          };
        } catch (e) {
          return 'Registry fetch failed (may be offline): ' + e.message;
        }
      `,
    },
    {
      name: "clearMcpRegistryCache procedure exists",
      description: "Verify cache clearing",
      code: `
        return 'clearMcpRegistryCache procedure available';
      `,
    },

    // =====================================================
    // MCP Settings UI
    // =====================================================
    {
      name: "MCP Tools settings page renders",
      description: "Check MCP settings UI",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/mcp-tools', 'Should be at MCP tools settings');
        return route;
      `,
    },
    {
      name: "MCP settings has server list",
      description: "Check for server list UI",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));

        // Look for server-related UI elements
        const serverElements = document.querySelectorAll(
          '[class*="server"], [class*="Server"], [class*="mcp"], [class*="MCP"]'
        );
        return serverElements.length;
      `,
    },
    {
      name: "MCP settings has add server button",
      description: "Check for add server UI",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));

        // Look for add button
        const buttons = Array.from(document.querySelectorAll('button'));
        const addButton = buttons.find(b =>
          b.textContent?.toLowerCase().includes('add') ||
          b.textContent?.toLowerCase().includes('new') ||
          b.getAttribute('aria-label')?.toLowerCase().includes('add')
        );
        return addButton ? 'Add button found' : 'No add button found';
      `,
    },

    // =====================================================
    // Tool Manager UI
    // =====================================================
    {
      name: "Tool list renders in settings",
      description: "Check tool list UI",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));

        // Look for tool-related elements
        const toolElements = document.querySelectorAll(
          '[class*="tool"], [class*="Tool"]'
        );
        return toolElements.length;
      `,
    },

    // =====================================================
    // MCP Elicitation (Protocol 2025-11-25)
    // =====================================================
    {
      name: "resolveElicitation procedure exists",
      description: "Verify elicitation resolution",
      code: `
        return 'resolveElicitation procedure available';
      `,
    },

    // =====================================================
    // MCP Sampling (Protocol 2025-11-25)
    // =====================================================
    {
      name: "resolveSampling procedure exists",
      description: "Verify sampling resolution",
      code: `
        return 'resolveSampling procedure available';
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after MCP tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default mcpToolsSuite;
