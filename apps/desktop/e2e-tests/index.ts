/**
 * SpeakMCP E2E Test Suite - Main Entry Point
 *
 * This file exports all test suites for execution via the electron-native MCP.
 *
 * Usage with Claude Code + electron-native MCP:
 * 1. Start the app: REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d
 * 2. Run tests using mcp__electron-native__electron_execute
 * 3. Tests execute in the renderer process context
 */

// Import all test suites - Core (P0)
import appLifecycleSuite from "./core/app-lifecycle.tests";
import routingSuite from "./navigation/routing.tests";
import tipcProceduresSuite from "./ipc/tipc-procedures.tests";
import agentSessionsSuite from "./sessions/agent-sessions.tests";
import sessionLifecycleSuite from "./sessions/session-lifecycle.tests";
import mcpToolsSuite from "./mcp/mcp-tools.tests";
import uiComponentsSuite from "./ui/ui-components.tests";

// Import P1 test suites
import settingsPagesSuite from "./ui/settings-pages.tests";
import conversationHistorySuite from "./conversations/conversation-history.tests";
import messageQueueSuite from "./message-queue/message-queue.tests";
import profileSystemSuite from "./profiles/profile-system.tests";

// Import P2 test suites
import elicitationSamplingSuite from "./elicitation/elicitation-sampling.tests";
import remoteServerSuite from "./remote-server/remote-server.tests";
import performanceSuite from "./performance/performance.tests";

// Import error handling and integration tests
import errorHandlingSuite from "./errors/error-handling.tests";
import workflowsSuite from "./integration/workflows.tests";

// Export framework utilities
export * from "./utils/test-framework";

// Export all test suites
export const testSuites = {
  // P0 - Core tests
  appLifecycle: appLifecycleSuite,
  routing: routingSuite,
  tipcProcedures: tipcProceduresSuite,
  agentSessions: agentSessionsSuite,
  sessionLifecycle: sessionLifecycleSuite,
  mcpTools: mcpToolsSuite,
  uiComponents: uiComponentsSuite,
  // P1 - Feature tests
  settingsPages: settingsPagesSuite,
  conversationHistory: conversationHistorySuite,
  messageQueue: messageQueueSuite,
  profileSystem: profileSystemSuite,
  // P2 - Advanced tests
  elicitationSampling: elicitationSamplingSuite,
  remoteServer: remoteServerSuite,
  performance: performanceSuite,
  // Error handling
  errorHandling: errorHandlingSuite,
  // Integration tests
  workflows: workflowsSuite,
};

// Export individual suites for targeted testing
export {
  // P0
  appLifecycleSuite,
  routingSuite,
  tipcProceduresSuite,
  agentSessionsSuite,
  sessionLifecycleSuite,
  mcpToolsSuite,
  uiComponentsSuite,
  // P1
  settingsPagesSuite,
  conversationHistorySuite,
  messageQueueSuite,
  profileSystemSuite,
  // P2
  elicitationSamplingSuite,
  remoteServerSuite,
  performanceSuite,
  // Error handling
  errorHandlingSuite,
  // Integration
  workflowsSuite,
};

// Get all tests flattened
export function getAllTests() {
  return Object.values(testSuites).flatMap((suite) =>
    suite.tests.map((test) => ({
      ...test,
      suite: suite.name,
      category: suite.category,
    }))
  );
}

// Get test count summary
export function getTestSummary() {
  const summary: Record<string, number> = {};
  let total = 0;

  for (const [key, suite] of Object.entries(testSuites)) {
    summary[key] = suite.tests.length;
    total += suite.tests.length;
  }

  return { ...summary, total };
}

// Get tests by priority
export function getTestsByPriority() {
  return {
    p0: {
      appLifecycle: appLifecycleSuite,
      routing: routingSuite,
      tipcProcedures: tipcProceduresSuite,
      agentSessions: agentSessionsSuite,
      sessionLifecycle: sessionLifecycleSuite,
      mcpTools: mcpToolsSuite,
      uiComponents: uiComponentsSuite,
    },
    p1: {
      settingsPages: settingsPagesSuite,
      conversationHistory: conversationHistorySuite,
      messageQueue: messageQueueSuite,
      profileSystem: profileSystemSuite,
    },
    p2: {
      elicitationSampling: elicitationSamplingSuite,
      remoteServer: remoteServerSuite,
      performance: performanceSuite,
    },
    errorHandling: {
      errorHandling: errorHandlingSuite,
    },
    integration: {
      workflows: workflowsSuite,
    },
  };
}

// Default export
export default testSuites;
