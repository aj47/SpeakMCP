/**
 * Core Infrastructure Tests - Application Lifecycle
 *
 * Tests the fundamental app startup, configuration, and lifecycle
 */

import { TestSuite, TestCase } from "../utils/test-framework";

export const appLifecycleSuite: TestSuite = {
  name: "Application Lifecycle",
  category: "Core Infrastructure",
  tests: [
    // =====================================================
    // Configuration Tests
    // =====================================================
    {
      name: "getConfig returns valid configuration object",
      description: "Verify that the app configuration is accessible",
      code: `
        const config = await helpers.ipc('getConfig');
        assert.isObject(config, 'Config should be an object');
        return config;
      `,
    },
    {
      name: "Config has required top-level properties",
      description: "Verify config structure contains essential fields",
      code: `
        const config = await helpers.ipc('getConfig');
        assert.hasProperty(config, 'provider', 'Config should have provider');
        assert.hasProperty(config, 'model', 'Config should have model');
        return Object.keys(config);
      `,
    },
    {
      name: "getDebugFlags returns debug flag state",
      description: "Verify debug flags are accessible",
      code: `
        const flags = await helpers.ipc('getDebugFlags');
        assert.isObject(flags, 'Debug flags should be an object');
        assert.hasProperty(flags, 'llm', 'Should have llm flag');
        assert.hasProperty(flags, 'tools', 'Should have tools flag');
        assert.hasProperty(flags, 'ui', 'Should have ui flag');
        assert.hasProperty(flags, 'app', 'Should have app flag');
        assert.hasProperty(flags, 'keybinds', 'Should have keybinds flag');
        return flags;
      `,
    },
    {
      name: "Debug flags are boolean values",
      description: "All debug flags should be booleans",
      code: `
        const flags = await helpers.ipc('getDebugFlags');
        assert.isBoolean(flags.llm, 'llm flag should be boolean');
        assert.isBoolean(flags.tools, 'tools flag should be boolean');
        assert.isBoolean(flags.ui, 'ui flag should be boolean');
        assert.isBoolean(flags.app, 'app flag should be boolean');
        assert.isBoolean(flags.keybinds, 'keybinds flag should be boolean');
        return true;
      `,
    },

    // =====================================================
    // Window & Display Tests
    // =====================================================
    {
      name: "Window object is available",
      description: "Verify window context is properly initialized",
      code: `
        assert.exists(window, 'Window should exist');
        assert.exists(window.document, 'Document should exist');
        assert.exists(window.location, 'Location should exist');
        return true;
      `,
    },
    {
      name: "Electron IPC is available in renderer",
      description: "Verify electron preload exposes IPC",
      code: `
        assert.exists(window.electron, 'window.electron should exist');
        assert.exists(window.electron.ipcRenderer, 'ipcRenderer should exist');
        assert.isFunction(window.electron.ipcRenderer.invoke, 'invoke should be a function');
        return true;
      `,
    },
    {
      name: "React root is mounted",
      description: "Verify React app is rendered",
      code: `
        const root = document.getElementById('root');
        assert.exists(root, 'Root element should exist');
        assert.truthy(root.children.length > 0, 'Root should have children');
        return root.children.length;
      `,
    },

    // =====================================================
    // Electron API Tests
    // =====================================================
    {
      name: "electronAPI is exposed",
      description: "Verify electronAPI from preload is available",
      code: `
        // electronAPI contains OAuth and MCP test methods
        assert.exists(window.electronAPI, 'electronAPI should exist');
        return Object.keys(window.electronAPI || {});
      `,
    },
    {
      name: "Process info is accessible",
      description: "Verify electron process info",
      code: `
        assert.exists(window.electron.process, 'process should exist');
        assert.hasProperty(window.electron.process, 'platform', 'Should have platform');
        return {
          platform: window.electron.process.platform,
          versions: window.electron.process.versions
        };
      `,
    },

    // =====================================================
    // Update System Tests
    // =====================================================
    {
      name: "getUpdateInfo returns update status",
      description: "Verify update checker is functional",
      code: `
        const updateInfo = await helpers.ipc('getUpdateInfo');
        // Update info can be null if no update available
        if (updateInfo) {
          assert.isObject(updateInfo, 'Update info should be object if present');
        }
        return updateInfo;
      `,
    },

    // =====================================================
    // Default System Prompt Tests
    // =====================================================
    {
      name: "getDefaultSystemPrompt returns prompt",
      description: "Verify default system prompt is accessible",
      code: `
        const prompt = await helpers.ipc('getDefaultSystemPrompt');
        assert.isString(prompt, 'System prompt should be a string');
        assert.truthy(prompt.length > 0, 'System prompt should not be empty');
        return prompt.length;
      `,
    },

    // =====================================================
    // Local Storage & State Tests
    // =====================================================
    {
      name: "localStorage is accessible",
      description: "Verify local storage works in renderer",
      code: `
        const testKey = '__e2e_test_key__';
        const testValue = { test: true, time: Date.now() };
        localStorage.setItem(testKey, JSON.stringify(testValue));
        const retrieved = JSON.parse(localStorage.getItem(testKey));
        localStorage.removeItem(testKey);
        assert.deepEqual(retrieved, testValue, 'Should retrieve stored value');
        return true;
      `,
    },
    {
      name: "sessionStorage is accessible",
      description: "Verify session storage works",
      code: `
        const testKey = '__e2e_session_test__';
        sessionStorage.setItem(testKey, 'test');
        const value = sessionStorage.getItem(testKey);
        sessionStorage.removeItem(testKey);
        assert.equal(value, 'test', 'Should retrieve session value');
        return true;
      `,
    },

    // =====================================================
    // DOM Ready State Tests
    // =====================================================
    {
      name: "Document is fully loaded",
      description: "Verify document ready state",
      code: `
        assert.equal(document.readyState, 'complete', 'Document should be complete');
        return document.readyState;
      `,
    },
    {
      name: "Head contains required meta tags",
      description: "Verify HTML head structure",
      code: `
        const charset = document.querySelector('meta[charset]');
        const viewport = document.querySelector('meta[name="viewport"]');
        assert.exists(charset, 'Should have charset meta tag');
        return {
          hasCharset: !!charset,
          hasViewport: !!viewport
        };
      `,
    },

    // =====================================================
    // Error Handling Tests
    // =====================================================
    {
      name: "getRecentErrors returns error log",
      description: "Verify error logging system",
      code: `
        const errors = await helpers.ipc('getRecentErrors');
        assert.isArray(errors, 'Recent errors should be an array');
        return errors.length;
      `,
    },

    // =====================================================
    // Health Check Tests
    // =====================================================
    {
      name: "performHealthCheck returns status",
      description: "Verify health check endpoint",
      code: `
        const health = await helpers.ipc('performHealthCheck');
        assert.isObject(health, 'Health check should return object');
        return health;
      `,
    },

    // =====================================================
    // Diagnostic Tests
    // =====================================================
    {
      name: "getDiagnosticReport generates report",
      description: "Verify diagnostic system",
      code: `
        const report = await helpers.ipc('getDiagnosticReport');
        assert.isObject(report, 'Diagnostic report should be object');
        return Object.keys(report);
      `,
    },
  ],
};

export default appLifecycleSuite;
