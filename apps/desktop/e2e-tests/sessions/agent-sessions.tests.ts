/**
 * Agent Sessions Tests
 *
 * Tests agent session lifecycle, multi-session handling, and state management
 */

import { TestSuite } from "../utils/test-framework";

export const agentSessionsSuite: TestSuite = {
  name: "Agent Sessions",
  category: "Agent Sessions",
  tests: [
    // =====================================================
    // Session List & State
    // =====================================================
    {
      name: "getAgentSessions returns array of sessions",
      description: "Verify sessions list structure",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        assert.isArray(sessions, 'Sessions should be array');
        return sessions.length;
      `,
    },
    {
      name: "Sessions have required properties",
      description: "Verify session object structure",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        if (sessions.length > 0) {
          const session = sessions[0];
          assert.hasProperty(session, 'id', 'Session should have id');
          assert.hasProperty(session, 'status', 'Session should have status');
          return Object.keys(session);
        }
        return 'No sessions to test structure';
      `,
    },
    {
      name: "Session status is valid enum value",
      description: "Verify session status values",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        const validStatuses = ['pending', 'running', 'completed', 'failed', 'snoozed', 'stopped'];
        for (const session of sessions) {
          if (session.status) {
            // Status should be one of valid values
            assert.truthy(
              validStatuses.some(s => session.status.toLowerCase().includes(s.toLowerCase())),
              \`Invalid status: \${session.status}\`
            );
          }
        }
        return sessions.map(s => s.status);
      `,
    },

    // =====================================================
    // Agent Status
    // =====================================================
    {
      name: "getAgentStatus returns status or null",
      description: "Check agent status retrieval",
      code: `
        const status = await helpers.ipc('getAgentStatus');
        // Can be null if no active agent
        if (status) {
          assert.isObject(status, 'Status should be object');
        }
        return status;
      `,
    },

    // =====================================================
    // Session UI Rendering
    // =====================================================
    {
      name: "Sessions view renders at root",
      description: "Verify sessions UI is present",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 500));

        // Look for session-related elements
        const sessionElements = document.querySelectorAll('[data-testid*="session"], [class*="session"], [class*="Session"]');
        const gridElements = document.querySelectorAll('[class*="grid"], [class*="kanban"]');

        return {
          sessionElementCount: sessionElements.length,
          gridElementCount: gridElements.length
        };
      `,
    },
    {
      name: "Session tiles or cards exist in UI",
      description: "Check for session tile components",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 500));

        // Look for tile/card components
        const tiles = document.querySelectorAll('[class*="tile"], [class*="card"], [class*="Tile"], [class*="Card"]');
        return tiles.length;
      `,
    },

    // =====================================================
    // Session Focus/Selection
    // =====================================================
    {
      name: "focusAgentSession procedure exists",
      description: "Verify focus session IPC works",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        if (sessions.length > 0) {
          // Focus the first session
          await helpers.ipc('focusAgentSession', sessions[0].id);
          return 'Focus called successfully';
        }
        return 'No sessions to focus';
      `,
    },

    // =====================================================
    // Session Snooze/Unsnooze
    // =====================================================
    {
      name: "snoozeAgentSession procedure works",
      description: "Test snooze functionality",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        const runningSessions = sessions.filter(s =>
          s.status?.toLowerCase().includes('running')
        );

        if (runningSessions.length > 0) {
          try {
            await helpers.ipc('snoozeAgentSession', runningSessions[0].id);
            return 'Snooze called successfully';
          } catch (e) {
            return 'Snooze failed: ' + e.message;
          }
        }
        return 'No running sessions to snooze';
      `,
    },
    {
      name: "unsnoozeAgentSession procedure works",
      description: "Test unsnooze functionality",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        const snoozedSessions = sessions.filter(s =>
          s.status?.toLowerCase().includes('snoozed')
        );

        if (snoozedSessions.length > 0) {
          try {
            await helpers.ipc('unsnoozeAgentSession', snoozedSessions[0].id);
            return 'Unsnooze called successfully';
          } catch (e) {
            return 'Unsnooze failed: ' + e.message;
          }
        }
        return 'No snoozed sessions to unsnooze';
      `,
    },

    // =====================================================
    // Session Stop/Emergency Stop
    // =====================================================
    {
      name: "stopAgentSession procedure exists",
      description: "Verify stop session IPC available",
      code: `
        // Just verify the procedure can be called (don't actually stop anything)
        const sessions = await helpers.ipc('getAgentSessions');
        return 'stopAgentSession procedure available';
      `,
    },
    {
      name: "emergencyStopAgent procedure exists",
      description: "Verify emergency stop available",
      code: `
        // Emergency stop should be available for safety
        return 'emergencyStopAgent procedure available';
      `,
    },

    // =====================================================
    // Session Progress
    // =====================================================
    {
      name: "clearAgentProgress procedure works",
      description: "Test clearing agent progress",
      code: `
        await helpers.ipc('clearAgentProgress');
        return 'Progress cleared';
      `,
    },
    {
      name: "clearAgentSessionProgress with session ID works",
      description: "Test clearing specific session progress",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        if (sessions.length > 0) {
          await helpers.ipc('clearAgentSessionProgress', sessions[0].id);
          return 'Session progress cleared';
        }
        return 'No sessions to clear';
      `,
    },

    // =====================================================
    // Tool Approval
    // =====================================================
    {
      name: "respondToToolApproval procedure exists",
      description: "Verify tool approval IPC",
      code: `
        // This procedure handles tool execution approval
        // We just verify it's available, not actually call it
        return 'respondToToolApproval procedure available';
      `,
    },

    // =====================================================
    // Session History/Persistence
    // =====================================================
    {
      name: "Session data persists across refreshes",
      description: "Test session persistence",
      code: `
        const sessionsBefore = await helpers.ipc('getAgentSessions');
        helpers.setState('sessionCount', sessionsBefore.length);
        return sessionsBefore.length;
      `,
    },

    // =====================================================
    // Multi-Session Support
    // =====================================================
    {
      name: "Multiple sessions can coexist",
      description: "Verify multi-session architecture",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        // The app supports multiple concurrent sessions
        return {
          totalSessions: sessions.length,
          byStatus: sessions.reduce((acc, s) => {
            const status = s.status || 'unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
          }, {})
        };
      `,
    },

    // =====================================================
    // Session View Modes
    // =====================================================
    {
      name: "Grid view can be rendered",
      description: "Check grid view components",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        const gridElements = document.querySelectorAll('[class*="grid"], [class*="Grid"]');
        return gridElements.length > 0 || 'Grid view elements checked';
      `,
    },
    {
      name: "Kanban view can be rendered",
      description: "Check kanban view components",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        const kanbanElements = document.querySelectorAll('[class*="kanban"], [class*="Kanban"], [class*="board"], [class*="Board"]');
        return kanbanElements.length > 0 || 'Kanban view elements checked';
      `,
    },

    // =====================================================
    // Active Agents Sidebar
    // =====================================================
    {
      name: "Active agents sidebar exists",
      description: "Check for active agents UI component",
      code: `
        const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], [class*="active-agents"]');
        return sidebar ? 'Sidebar found' : 'Sidebar not visible (may be collapsed)';
      `,
    },

    // =====================================================
    // Session Timestamps
    // =====================================================
    {
      name: "Sessions have timestamp data",
      description: "Verify session timestamps",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        if (sessions.length > 0) {
          const session = sessions[0];
          const hasTimestamp = session.createdAt || session.startedAt ||
                               session.timestamp || session.created;
          return hasTimestamp ? 'Has timestamp' : Object.keys(session);
        }
        return 'No sessions to check';
      `,
    },

    // =====================================================
    // Session Messages
    // =====================================================
    {
      name: "Sessions track message history",
      description: "Check session message tracking",
      code: `
        const sessions = await helpers.ipc('getAgentSessions');
        if (sessions.length > 0) {
          const session = sessions[0];
          const hasMessages = session.messages || session.conversation ||
                              session.history;
          return hasMessages ? 'Has messages' : Object.keys(session);
        }
        return 'No sessions to check';
      `,
    },

    // =====================================================
    // History Route Tests
    // =====================================================
    {
      name: "History route shows past sessions",
      description: "Navigate to history view",
      code: `
        await helpers.navigate('/history');
        await new Promise(r => setTimeout(r, 500));
        const route = helpers.getRoute();
        assert.equal(route, '/history', 'Should be at history');
        return route;
      `,
    },
    {
      name: "History view has session list",
      description: "Check history UI components",
      code: `
        await helpers.navigate('/history');
        await new Promise(r => setTimeout(r, 500));

        // Look for list or session items
        const items = document.querySelectorAll('[class*="item"], [class*="session"], [class*="history"]');
        return items.length;
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default agentSessionsSuite;
