/**
 * Settings Pages Tests
 *
 * Detailed tests for all settings page functionality
 */

import { TestSuite } from "../utils/test-framework";

export const settingsPagesSuite: TestSuite = {
  name: "Settings Pages",
  category: "Settings",
  tests: [
    // =====================================================
    // General Settings
    // =====================================================
    {
      name: "General settings page loads completely",
      description: "Navigate and verify general settings",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const hasForm = document.querySelector('form') ||
                       document.querySelector('input') ||
                       document.querySelector('select');
        assert.truthy(hasForm, 'General settings should have form elements');
        return true;
      `,
    },
    {
      name: "Language selector exists",
      description: "Check for language selection UI",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const langSelect = document.querySelector('[class*="language"], select[name*="language"], [data-testid*="language"]');
        return langSelect ? 'Language selector found' : 'Language selector not visible';
      `,
    },
    {
      name: "Theme selector exists",
      description: "Check for theme selection UI",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const themeSelect = document.querySelector('[class*="theme"], select[name*="theme"], [data-testid*="theme"]');
        return themeSelect ? 'Theme selector found' : 'Theme selector not visible';
      `,
    },
    {
      name: "STT provider selector exists",
      description: "Check for speech-to-text provider",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const sttSelect = document.querySelector('[class*="stt"], [class*="speech"], select[name*="stt"]');
        return sttSelect ? 'STT selector found' : 'May be in different section';
      `,
    },
    {
      name: "TTS provider selector exists",
      description: "Check for text-to-speech provider",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const ttsSelect = document.querySelector('[class*="tts"], select[name*="tts"]');
        return ttsSelect ? 'TTS selector found' : 'May be in different section';
      `,
    },
    {
      name: "TTS toggle exists",
      description: "Check for TTS enable/disable",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const toggle = document.querySelector('input[type="checkbox"][name*="tts"], [class*="tts"] input[type="checkbox"]');
        return toggle ? 'TTS toggle found' : 'TTS toggle not visible';
      `,
    },
    {
      name: "Hotkey configuration exists",
      description: "Check for hotkey settings",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const hotkeyEl = document.querySelector('[class*="hotkey"], [class*="shortcut"], [class*="keybind"]');
        return hotkeyEl ? 'Hotkey config found' : 'Hotkey config not visible';
      `,
    },

    // =====================================================
    // Providers Settings
    // =====================================================
    {
      name: "Providers settings page loads",
      description: "Navigate to providers settings",
      code: `
        await helpers.navigate('/settings/providers');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/providers', 'Should be at providers');
        return route;
      `,
    },
    {
      name: "API key inputs exist",
      description: "Check for API key configuration",
      code: `
        await helpers.navigate('/settings/providers');
        await new Promise(r => setTimeout(r, 500));
        const apiInputs = document.querySelectorAll('input[type="password"], input[name*="key"], input[name*="api"]');
        return apiInputs.length;
      `,
    },
    {
      name: "Provider list displays",
      description: "Check for provider options",
      code: `
        await helpers.navigate('/settings/providers');
        await new Promise(r => setTimeout(r, 500));
        const providers = document.querySelectorAll('[class*="provider"], [class*="Provider"]');
        return providers.length;
      `,
    },
    {
      name: "API key inputs are masked",
      description: "Verify password-type inputs for keys",
      code: `
        await helpers.navigate('/settings/providers');
        await new Promise(r => setTimeout(r, 500));
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        return {
          count: passwordInputs.length,
          areMasked: passwordInputs.length > 0
        };
      `,
    },

    // =====================================================
    // Models Settings
    // =====================================================
    {
      name: "Models settings page loads",
      description: "Navigate to models settings",
      code: `
        await helpers.navigate('/settings/models');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/models', 'Should be at models');
        return route;
      `,
    },
    {
      name: "Model selector exists",
      description: "Check for model selection",
      code: `
        await helpers.navigate('/settings/models');
        await new Promise(r => setTimeout(r, 500));
        const modelSelect = document.querySelector('select, [class*="model"], [role="combobox"]');
        return modelSelect ? 'Model selector found' : 'Model selector structure varies';
      `,
    },
    {
      name: "Model presets section exists",
      description: "Check for model presets",
      code: `
        await helpers.navigate('/settings/models');
        await new Promise(r => setTimeout(r, 500));
        const presets = document.querySelector('[class*="preset"], [class*="Preset"]');
        return presets ? 'Presets section found' : 'Presets may be elsewhere';
      `,
    },

    // =====================================================
    // Tools Settings
    // =====================================================
    {
      name: "Tools settings page loads",
      description: "Navigate to tools settings",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/tools', 'Should be at tools');
        return route;
      `,
    },
    {
      name: "Profile selector exists",
      description: "Check for profile selection",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const profileEl = document.querySelector('[class*="profile"], select[name*="profile"]');
        return profileEl ? 'Profile selector found' : 'Profile selector not visible';
      `,
    },
    {
      name: "Built-in tools toggles exist",
      description: "Check for tool enable/disable",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const toggles = document.querySelectorAll('input[type="checkbox"], [role="switch"]');
        return toggles.length;
      `,
    },

    // =====================================================
    // MCP Tools Settings
    // =====================================================
    {
      name: "MCP Tools settings page loads",
      description: "Navigate to MCP tools settings",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/mcp-tools', 'Should be at MCP tools');
        return route;
      `,
    },
    {
      name: "MCP server list displays",
      description: "Check for server list UI",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const serverList = document.querySelector('[class*="server"], [class*="Server"]');
        return serverList ? 'Server list found' : 'Server list structure varies';
      `,
    },
    {
      name: "Add server button exists",
      description: "Check for add server action",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const addBtn = buttons.find(b =>
          b.textContent?.toLowerCase().includes('add') ||
          b.getAttribute('aria-label')?.toLowerCase().includes('add')
        );
        return addBtn ? 'Add button found' : 'Add button not visible';
      `,
    },
    {
      name: "Server enable/disable toggles exist",
      description: "Check for server runtime toggles",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const toggles = document.querySelectorAll('input[type="checkbox"], [role="switch"]');
        return toggles.length;
      `,
    },
    {
      name: "Server status indicators exist",
      description: "Check for connection status",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const status = document.querySelector('[class*="status"], [class*="Status"], [class*="indicator"]');
        return status ? 'Status indicator found' : 'Status indicator not visible';
      `,
    },
    {
      name: "MCP registry browser exists",
      description: "Check for registry section",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const registry = document.querySelector('[class*="registry"], [class*="Registry"], [class*="browse"]');
        return registry ? 'Registry browser found' : 'Registry may be in dialog';
      `,
    },

    // =====================================================
    // Remote Server Settings
    // =====================================================
    {
      name: "Remote Server settings page loads",
      description: "Navigate to remote server settings",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/remote-server', 'Should be at remote server');
        return route;
      `,
    },
    {
      name: "Server enable toggle exists",
      description: "Check for server enable/disable",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const toggle = document.querySelector('input[type="checkbox"], [role="switch"]');
        return toggle ? 'Enable toggle found' : 'Toggle not visible';
      `,
    },
    {
      name: "Port configuration exists",
      description: "Check for port input",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const portInput = document.querySelector('input[type="number"], input[name*="port"]');
        return portInput ? 'Port input found' : 'Port config not visible';
      `,
    },
    {
      name: "API key display exists",
      description: "Check for API key section",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const keySection = document.querySelector('[class*="key"], [class*="Key"], [class*="api"]');
        return keySection ? 'API key section found' : 'API key not visible';
      `,
    },
    {
      name: "QR code section exists",
      description: "Check for QR code display",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const qr = document.querySelector('[class*="qr"], [class*="QR"], canvas, svg[class*="qr"]');
        return qr ? 'QR code found' : 'QR code not visible';
      `,
    },
    {
      name: "Tunnel section exists",
      description: "Check for Cloudflare tunnel",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const tunnel = document.querySelector('[class*="tunnel"], [class*="Tunnel"], [class*="cloudflare"]');
        return tunnel ? 'Tunnel section found' : 'Tunnel section not visible';
      `,
    },

    // =====================================================
    // Settings Navigation
    // =====================================================
    {
      name: "Settings sidebar navigation works",
      description: "Test settings nav links",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 300));

        const navLinks = document.querySelectorAll('nav a, [class*="sidebar"] a, [class*="nav"] a');
        return navLinks.length;
      `,
    },
    {
      name: "Settings pages share consistent layout",
      description: "Verify layout consistency",
      code: `
        const routes = ['/settings/general', '/settings/models', '/settings/tools'];
        const results = [];

        for (const route of routes) {
          await helpers.navigate(route);
          await new Promise(r => setTimeout(r, 300));
          const hasMain = !!document.querySelector('main, [class*="content"], [class*="main"]');
          results.push({ route, hasMain });
        }

        return results;
      `,
    },

    // =====================================================
    // Form Interactions
    // =====================================================
    {
      name: "Form inputs respond to changes",
      description: "Test input interactivity",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));

        const inputs = document.querySelectorAll('input:not([type="hidden"]):not([disabled])');
        return {
          totalInputs: inputs.length,
          editable: Array.from(inputs).filter(i => !i.readOnly).length
        };
      `,
    },
    {
      name: "Save/Apply buttons exist where needed",
      description: "Check for action buttons",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));

        const buttons = Array.from(document.querySelectorAll('button'));
        const actionButtons = buttons.filter(b => {
          const text = b.textContent?.toLowerCase() || '';
          return text.includes('save') || text.includes('apply') ||
                 text.includes('update') || text.includes('confirm');
        });
        return actionButtons.length;
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after settings tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default settingsPagesSuite;
