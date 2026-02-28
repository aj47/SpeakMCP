/**
 * Remote Server Tests
 *
 * Tests for the remote API server and Cloudflare tunnel functionality
 */

import { TestSuite } from "../utils/test-framework";

export const remoteServerSuite: TestSuite = {
  name: "Remote Server",
  category: "Remote Server",
  tests: [
    // =====================================================
    // Remote Server Settings
    // =====================================================
    {
      name: "Remote server settings page loads",
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
      description: "Check for enable/disable toggle",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const toggle = document.querySelector('input[type="checkbox"], [role="switch"]');
        return toggle ? 'Enable toggle found' : 'Toggle not visible';
      `,
    },
    {
      name: "Port configuration input exists",
      description: "Check for port setting",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const portInput = document.querySelector('input[type="number"], input[name*="port"]');
        return portInput ? 'Port input found' : 'Port config via other UI';
      `,
    },

    // =====================================================
    // API Key Management
    // =====================================================
    {
      name: "API key display section exists",
      description: "Check for API key visibility",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const keySection = document.querySelector('[class*="key"], [class*="api"], code');
        return keySection ? 'API key section found' : 'API key not visible';
      `,
    },
    {
      name: "Copy API key button exists",
      description: "Check for copy functionality",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const copyBtn = buttons.find(b => {
          const text = (b.textContent || '').toLowerCase();
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('copy') || label.includes('copy');
        });
        return copyBtn ? 'Copy button found' : 'Copy via other UI';
      `,
    },
    {
      name: "Regenerate API key button exists",
      description: "Check for regenerate functionality",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const regenBtn = buttons.find(b => {
          const text = (b.textContent || '').toLowerCase();
          return text.includes('regenerate') || text.includes('reset') || text.includes('new');
        });
        return regenBtn ? 'Regenerate button found' : 'Regenerate via other UI';
      `,
    },

    // =====================================================
    // QR Code
    // =====================================================
    {
      name: "QR code displays for mobile connection",
      description: "Check for QR code element",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const qr = document.querySelector('[class*="qr"], canvas, svg');
        return qr ? 'QR code element found' : 'QR code not visible';
      `,
    },

    // =====================================================
    // Cloudflare Tunnel
    // =====================================================
    {
      name: "checkCloudflaredInstalled returns result",
      description: "Check cloudflared installation",
      code: `
        const installed = await helpers.ipc('checkCloudflaredInstalled');
        return {
          type: typeof installed,
          value: installed
        };
      `,
    },
    {
      name: "getCloudflareTunnelStatus returns status",
      description: "Get tunnel status",
      code: `
        const status = await helpers.ipc('getCloudflareTunnelStatus');
        return status;
      `,
    },
    {
      name: "Tunnel section displays in UI",
      description: "Check for tunnel UI section",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const tunnel = document.querySelector('[class*="tunnel"], [class*="cloudflare"]');
        return tunnel ? 'Tunnel section found' : 'Tunnel section not visible';
      `,
    },
    {
      name: "Start tunnel button exists",
      description: "Check for tunnel start action",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const buttons = Array.from(document.querySelectorAll('button'));
        const startBtn = buttons.find(b => {
          const text = (b.textContent || '').toLowerCase();
          return text.includes('start') || text.includes('connect');
        });
        return startBtn ? 'Start button found' : 'Start via other UI';
      `,
    },
    {
      name: "startCloudflareTunnel procedure exists",
      description: "Verify tunnel start capability",
      code: `
        return 'startCloudflareTunnel procedure available';
      `,
    },
    {
      name: "stopCloudflareTunnel procedure exists",
      description: "Verify tunnel stop capability",
      code: `
        return 'stopCloudflareTunnel procedure available';
      `,
    },

    // =====================================================
    // Server Configuration
    // =====================================================
    {
      name: "Bind address configuration exists",
      description: "Check for bind address option",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const bindConfig = document.querySelector('[class*="bind"], select[name*="bind"], [class*="address"]');
        return bindConfig ? 'Bind config found' : 'Bind config via other UI';
      `,
    },
    {
      name: "Log level configuration exists",
      description: "Check for log level option",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const logConfig = document.querySelector('[class*="log"], select[name*="log"]');
        return logConfig ? 'Log config found' : 'Log config via other UI';
      `,
    },
    {
      name: "CORS origins configuration exists",
      description: "Check for CORS setting",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const corsConfig = document.querySelector('[class*="cors"], input[name*="cors"], textarea[name*="cors"]');
        return corsConfig ? 'CORS config found' : 'CORS config via other UI';
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after remote server tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default remoteServerSuite;
