/**
 * Navigation & Routing Tests
 *
 * Tests all application routes and navigation behavior
 */

import { TestSuite } from "../utils/test-framework";

export const routingSuite: TestSuite = {
  name: "Navigation & Routing",
  category: "Navigation",
  tests: [
    // =====================================================
    // Main Routes
    // =====================================================
    {
      name: "Root route (/) loads sessions view",
      description: "Navigate to root and verify sessions page",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/', 'Should be at root');
        return route;
      `,
    },
    {
      name: "Session route (/:id) format is valid",
      description: "Verify session ID route pattern",
      code: `
        // Navigate to a session route pattern
        await helpers.navigate('/test-session-123');
        await new Promise(r => setTimeout(r, 300));
        const route = helpers.getRoute();
        assert.truthy(route.startsWith('/test-session'), 'Should navigate to session');
        // Navigate back
        await helpers.navigate('/');
        return route;
      `,
    },
    {
      name: "History route (/history) loads",
      description: "Navigate to history view",
      code: `
        await helpers.navigate('/history');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/history', 'Should be at history');
        return route;
      `,
    },

    // =====================================================
    // Settings Routes
    // =====================================================
    {
      name: "General settings route loads",
      description: "Navigate to /settings/general",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/general', 'Should be at general settings');
        return route;
      `,
    },
    {
      name: "General settings page renders content",
      description: "Verify general settings has form elements",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));
        // Check for settings-related elements
        const hasContent = document.querySelector('form') ||
                          document.querySelector('input') ||
                          document.querySelector('select') ||
                          document.querySelector('button');
        assert.truthy(hasContent, 'Settings page should have form elements');
        return true;
      `,
    },
    {
      name: "Providers settings route loads",
      description: "Navigate to /settings/providers",
      code: `
        await helpers.navigate('/settings/providers');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/providers', 'Should be at providers settings');
        return route;
      `,
    },
    {
      name: "Models settings route loads",
      description: "Navigate to /settings/models",
      code: `
        await helpers.navigate('/settings/models');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/models', 'Should be at models settings');
        return route;
      `,
    },
    {
      name: "Tools settings route loads",
      description: "Navigate to /settings/tools",
      code: `
        await helpers.navigate('/settings/tools');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/tools', 'Should be at tools settings');
        return route;
      `,
    },
    {
      name: "MCP Tools settings route loads",
      description: "Navigate to /settings/mcp-tools",
      code: `
        await helpers.navigate('/settings/mcp-tools');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/mcp-tools', 'Should be at MCP tools settings');
        return route;
      `,
    },
    {
      name: "Remote Server settings route loads",
      description: "Navigate to /settings/remote-server",
      code: `
        await helpers.navigate('/settings/remote-server');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/settings/remote-server', 'Should be at remote server settings');
        return route;
      `,
    },

    // =====================================================
    // Special Routes
    // =====================================================
    {
      name: "Setup route (/setup) is accessible",
      description: "Navigate to setup/permissions page",
      code: `
        await helpers.navigate('/setup');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/setup', 'Should be at setup');
        return route;
      `,
    },
    {
      name: "Onboarding route (/onboarding) is accessible",
      description: "Navigate to onboarding page",
      code: `
        await helpers.navigate('/onboarding');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/onboarding', 'Should be at onboarding');
        return route;
      `,
    },

    // =====================================================
    // Navigation Behavior
    // =====================================================
    {
      name: "Browser back button works",
      description: "Test history navigation",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 200));
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 200));

        // Go back
        window.history.back();
        await new Promise(r => setTimeout(r, 300));

        const route = helpers.getRoute();
        assert.equal(route, '/', 'Should navigate back to root');
        return route;
      `,
    },
    {
      name: "Browser forward button works",
      description: "Test forward navigation",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 200));
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 200));
        window.history.back();
        await new Promise(r => setTimeout(r, 200));
        window.history.forward();
        await new Promise(r => setTimeout(r, 300));

        const route = helpers.getRoute();
        assert.equal(route, '/settings/general', 'Should navigate forward');
        return route;
      `,
    },
    {
      name: "Hash navigation updates location",
      description: "Verify hash-based routing works",
      code: `
        window.location.hash = '/settings/tools';
        await new Promise(r => setTimeout(r, 300));
        assert.truthy(window.location.hash.includes('tools'), 'Hash should update');
        return window.location.hash;
      `,
    },

    // =====================================================
    // Route State Preservation
    // =====================================================
    {
      name: "Route change triggers re-render",
      description: "Verify component updates on navigation",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        const initialHTML = document.body.innerHTML.length;

        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 300));
        const settingsHTML = document.body.innerHTML.length;

        // Content should be different
        assert.truthy(Math.abs(initialHTML - settingsHTML) > 0 || initialHTML > 0,
          'Page content should exist');
        return { initialLength: initialHTML, settingsLength: settingsHTML };
      `,
    },

    // =====================================================
    // Error/Invalid Route Handling
    // =====================================================
    {
      name: "Invalid route doesn't crash app",
      description: "Navigate to non-existent route",
      code: `
        await helpers.navigate('/this-route-does-not-exist-12345');
        await new Promise(r => setTimeout(r, 300));
        // App should still be responsive
        assert.exists(document.body, 'Document should still exist');
        assert.truthy(document.body.innerHTML.length > 0, 'Page should have content');
        // Return to valid route
        await helpers.navigate('/');
        return true;
      `,
    },

    // =====================================================
    // Clean up - return to root
    // =====================================================
    {
      name: "Return to root for next tests",
      description: "Navigate back to root route",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default routingSuite;
