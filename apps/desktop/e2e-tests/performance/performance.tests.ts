/**
 * Performance Tests
 *
 * Tests for application performance, load handling, and stress testing
 */

import { TestSuite } from "../utils/test-framework";

export const performanceSuite: TestSuite = {
  name: "Performance",
  category: "Performance",
  tests: [
    // =====================================================
    // IPC Performance
    // =====================================================
    {
      name: "IPC calls complete within acceptable time",
      description: "Test IPC latency",
      code: `
        const calls = ['getConfig', 'getDebugFlags', 'getProfiles', 'getMcpServerStatus'];
        const results = [];

        for (const call of calls) {
          const start = Date.now();
          await helpers.ipc(call);
          const duration = Date.now() - start;
          results.push({ call, duration, acceptable: duration < 1000 });
        }

        const allAcceptable = results.every(r => r.acceptable);
        return { results, allAcceptable };
      `,
    },
    {
      name: "Multiple concurrent IPC calls work",
      description: "Test concurrent IPC",
      code: `
        const start = Date.now();
        const promises = [
          helpers.ipc('getConfig'),
          helpers.ipc('getDebugFlags'),
          helpers.ipc('getProfiles'),
          helpers.ipc('getMcpServerStatus'),
          helpers.ipc('getAgentSessions')
        ];

        await Promise.all(promises);
        const duration = Date.now() - start;

        return {
          concurrentCalls: promises.length,
          totalDuration: duration,
          avgPerCall: Math.round(duration / promises.length)
        };
      `,
    },
    {
      name: "Rapid IPC calls are stable",
      description: "Test IPC under rapid calls",
      code: `
        const iterations = 20;
        const start = Date.now();
        const errors = [];

        for (let i = 0; i < iterations; i++) {
          try {
            await helpers.ipc('getConfig');
          } catch (e) {
            errors.push(i);
          }
        }

        const duration = Date.now() - start;
        return {
          iterations,
          errors: errors.length,
          duration,
          stable: errors.length === 0
        };
      `,
    },

    // =====================================================
    // Navigation Performance
    // =====================================================
    {
      name: "Route changes are fast",
      description: "Test navigation speed",
      code: `
        const routes = ['/', '/settings/general', '/history', '/settings/tools'];
        const times = [];

        for (const route of routes) {
          const start = Date.now();
          await helpers.navigate(route);
          await new Promise(r => setTimeout(r, 100));
          times.push({ route, duration: Date.now() - start });
        }

        await helpers.navigate('/');
        const avgTime = Math.round(times.reduce((s, t) => s + t.duration, 0) / times.length);

        return {
          times,
          averageMs: avgTime,
          acceptable: avgTime < 500
        };
      `,
    },

    // =====================================================
    // DOM Performance
    // =====================================================
    {
      name: "DOM updates are responsive",
      description: "Test DOM manipulation speed",
      code: `
        const start = Date.now();

        // Perform DOM queries
        for (let i = 0; i < 100; i++) {
          document.querySelectorAll('button');
          document.querySelectorAll('input');
          document.querySelectorAll('[class*="session"]');
        }

        const duration = Date.now() - start;
        return {
          queries: 300,
          duration,
          acceptable: duration < 200
        };
      `,
    },
    {
      name: "Page has acceptable element count",
      description: "Check DOM complexity",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 500));

        const allElements = document.querySelectorAll('*').length;
        const buttons = document.querySelectorAll('button').length;
        const inputs = document.querySelectorAll('input').length;

        return {
          totalElements: allElements,
          buttons,
          inputs,
          reasonable: allElements < 5000
        };
      `,
    },

    // =====================================================
    // Memory Indicators
    // =====================================================
    {
      name: "State management is efficient",
      description: "Test state operations",
      code: `
        const start = Date.now();

        // Rapid state operations
        for (let i = 0; i < 50; i++) {
          helpers.setState('perf_test_' + i, { value: i, data: 'x'.repeat(100) });
        }

        for (let i = 0; i < 50; i++) {
          helpers.getState('perf_test_' + i);
        }

        // Cleanup
        for (let i = 0; i < 50; i++) {
          helpers.setState('perf_test_' + i, null);
        }

        const duration = Date.now() - start;
        return {
          operations: 150,
          duration,
          efficient: duration < 100
        };
      `,
    },

    // =====================================================
    // Data Size Handling
    // =====================================================
    {
      name: "Large conversation history handled",
      description: "Test with many conversations",
      code: `
        const start = Date.now();
        const history = await helpers.ipc('getConversationHistory');
        const duration = Date.now() - start;

        return {
          count: history.length,
          loadTime: duration,
          acceptable: duration < 2000
        };
      `,
    },
    {
      name: "Large profile list handled",
      description: "Test profile retrieval",
      code: `
        const start = Date.now();
        const profiles = await helpers.ipc('getProfiles');
        const duration = Date.now() - start;

        return {
          count: profiles.length,
          loadTime: duration,
          acceptable: duration < 500
        };
      `,
    },
    {
      name: "MCP tool list retrieval is fast",
      description: "Test tool list performance",
      code: `
        const start = Date.now();
        const tools = await helpers.ipc('getMcpDetailedToolList');
        const duration = Date.now() - start;

        const toolCount = Array.isArray(tools) ? tools.length :
                         Object.values(tools || {}).flat().length;

        return {
          toolCount,
          loadTime: duration,
          acceptable: duration < 2000
        };
      `,
    },

    // =====================================================
    // Render Performance
    // =====================================================
    {
      name: "Initial render completes quickly",
      description: "Test page load performance",
      code: `
        await helpers.navigate('/');
        const start = Date.now();
        await new Promise(r => setTimeout(r, 500));

        const hasContent = document.body.innerHTML.length > 1000;
        const hasButtons = document.querySelectorAll('button').length > 0;
        const duration = Date.now() - start;

        return {
          hasContent,
          hasButtons,
          verifyDuration: duration
        };
      `,
    },
    {
      name: "Settings page renders quickly",
      description: "Test settings render performance",
      code: `
        const start = Date.now();
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 300));

        const hasInputs = document.querySelectorAll('input').length > 0;
        const duration = Date.now() - start;

        await helpers.navigate('/');
        return {
          hasInputs,
          renderTime: duration,
          acceptable: duration < 1000
        };
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after performance tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default performanceSuite;
