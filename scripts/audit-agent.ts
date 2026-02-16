#!/usr/bin/env tsx
/**
 * Autonomous UI/UX Audit Agent
 *
 * This script uses the Claude Agent SDK to automatically:
 * - Test UI/UX flows in the SpeakMCP application
 * - Identify and fix issues autonomously
 * - Commit and push changes
 * - Update AUDIT.md with findings
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..");
const AUDIT_FILE = path.join(PROJECT_ROOT, "AUDIT.md");
const LOG_FILE = path.join(PROJECT_ROOT, "audit-agent.log");

interface AuditFlow {
  number: number;
  name: string;
  priority: string;
  description: string;
}

/**
 * Log message to console and file
 */
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + "\n");
}

/**
 * Parse AUDIT.md to find the next pending flow to test
 */
function findNextPendingFlow(): AuditFlow | null {
  try {
    const auditContent = fs.readFileSync(AUDIT_FILE, "utf-8");

    // Find all flows with their status
    const flowRegex = /#### (\d+)\.\s+(.+?)\n\*\*Status:\*\*\s+([⏳🔄✅🔧❌])\s+(\w+)\n\*\*Priority:\*\*\s+(\w+)\n\*\*Description:\*\*\s+(.+?)(?=\n\*\*)/gs;
    const flows: AuditFlow[] = [];

    let match;
    while ((match = flowRegex.exec(auditContent)) !== null) {
      const [, number, name, , status, priority, description] = match;

      if (status === "Pending") {
        flows.push({
          number: parseInt(number, 10),
          name: name.trim(),
          priority: priority.trim(),
          description: description.trim(),
        });
      }
    }

    if (flows.length === 0) {
      log("No pending flows found. All flows have been tested!");
      return null;
    }

    // Prioritize: Critical > High > Medium > Low
    const priorityOrder = { "Critical": 0, "High": 1, "Medium": 2, "Low": 3 };
    flows.sort((a, b) => {
      const priorityA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 999;
      const priorityB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 999;
      return priorityA - priorityB || a.number - b.number;
    });

    return flows[0];
  } catch (error) {
    log(`Error parsing AUDIT.md: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Update AUDIT.md with test results
 */
function updateAuditResults(
  flowNumber: number,
  status: string,
  issuesFound: string[],
  fixesApplied: string[],
  commitHash?: string
) {
  try {
    let auditContent = fs.readFileSync(AUDIT_FILE, "utf-8");
    const timestamp = new Date().toISOString();

    // Update the specific flow status
    const flowHeaderRegex = new RegExp(
      `(#### ${flowNumber}\\..+?\\n\\*\\*Status:\\*\\*)\\s+[⏳🔄✅🔧❌]\\s+\\w+`,
      "s"
    );

    let statusEmoji = "✅";
    let statusText = "Passed";

    if (status === "fixed") {
      statusEmoji = "🔧";
      statusText = "Fixed";
    } else if (status === "failed") {
      statusEmoji = "❌";
      statusText = "Failed";
    }

    auditContent = auditContent.replace(
      flowHeaderRegex,
      `$1 ${statusEmoji} ${statusText}`
    );

    // Update Last Tested, Issues Found, and Fixes Applied
    const flowSectionRegex = new RegExp(
      `(#### ${flowNumber}\\..+?)(\\*\\*Last Tested:\\*\\*)([^\\n]+)(\\n\\*\\*Issues Found:\\*\\*)([^\\n]+)(\\n\\*\\*Fixes Applied:\\*\\*)([^\\n]+)`,
      "s"
    );

    auditContent = auditContent.replace(
      flowSectionRegex,
      `$1$2 ${timestamp}$4 ${issuesFound.length}$6 ${fixesApplied.length}`
    );

    // Append to Run Log
    const runLogEntry = `
[${timestamp}] Run #${Date.now()}
Flow Tested: Flow #${flowNumber}
Status: ${statusText}
Issues Found: ${issuesFound.length}
Fixes Applied: ${fixesApplied.length}
${commitHash ? `Commit: ${commitHash}` : "Commit: No changes"}
`;

    const runLogMarker = "This section will be populated by the agent with each run:";
    auditContent = auditContent.replace(
      runLogMarker,
      `${runLogMarker}\n${runLogEntry}`
    );

    // Update metrics
    const pendingCount = (auditContent.match(/\*\*Status:\*\*\s+⏳\s+Pending/g) || []).length;
    const passedCount = (auditContent.match(/\*\*Status:\*\*\s+✅\s+Passed/g) || []).length;
    const fixedCount = (auditContent.match(/\*\*Status:\*\*\s+🔧\s+Fixed/g) || []).length;
    const failedCount = (auditContent.match(/\*\*Status:\*\*\s+❌\s+Failed/g) || []).length;
    const totalFlows = 21;
    const tested = passedCount + fixedCount + failedCount;
    const coverage = Math.round((tested / totalFlows) * 100);

    auditContent = auditContent.replace(
      /- \*\*Total Flows:\*\* \d+\n- \*\*Tested:\*\* \d+\n- \*\*Passed:\*\* \d+\n- \*\*Fixed:\*\* \d+\n- \*\*Pending:\*\* \d+\n- \*\*Failed:\*\* \d+\n- \*\*Coverage:\*\* \d+%/,
      `- **Total Flows:** ${totalFlows}\n- **Tested:** ${tested}\n- **Passed:** ${passedCount}\n- **Fixed:** ${fixedCount}\n- **Pending:** ${pendingCount}\n- **Failed:** ${failedCount}\n- **Coverage:** ${coverage}%`
    );

    // Update last updated timestamp
    auditContent = auditContent.replace(
      /Last Updated: .+$/m,
      `Last Updated: ${new Date().toISOString().split("T")[0]}`
    );

    fs.writeFileSync(AUDIT_FILE, auditContent);
    log(`Updated AUDIT.md with results for flow #${flowNumber}`);
  } catch (error) {
    log(`Error updating AUDIT.md: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run the autonomous agent to test a UI/UX flow
 */
async function runAuditAgent(flow: AuditFlow): Promise<void> {
  log(`\n${"=".repeat(80)}`);
  log(`Starting audit for Flow #${flow.number}: ${flow.name}`);
  log(`Priority: ${flow.priority}`);
  log(`Description: ${flow.description}`);
  log(`${"=".repeat(80)}\n`);

  const issuesFound: string[] = [];
  const fixesApplied: string[] = [];
  let commitHash: string | undefined;

  try {
    // Read the full flow details from AUDIT.md for context
    const auditContent = fs.readFileSync(AUDIT_FILE, "utf-8");
    const flowSectionRegex = new RegExp(
      `#### ${flow.number}\\..+?(?=#### \\d+\\.|---\\n\\n## UI/UX Best Practices)`,
      "s"
    );
    const flowSection = auditContent.match(flowSectionRegex)?.[0] || "";

    const agentPrompt = `You are testing Flow #${flow.number}: "${flow.name}" for the SpeakMCP desktop application.

${flowSection}

Your task:
1. Build the desktop app if needed: \`pnpm --filter @speakmcp/desktop build\`
2. Critically analyze the UI/UX for this specific flow
3. Test all expected behaviors listed in the flow requirements
4. Identify ANY issues that violate the UI/UX requirements or best practices
5. Fix ALL issues you find in the source code
6. Run tests to ensure no regressions: \`pnpm --filter @speakmcp/desktop test:run\`
7. Commit your changes with a descriptive message following the format in AUDIT.md

IMPORTANT INSTRUCTIONS:
- Be AUTONOMOUS - never ask questions, make reasonable decisions
- Be CRITICAL - look for subtle issues, not just obvious bugs
- Fix issues IMMEDIATELY when found - don't just report them
- Check accessibility (WCAG 2.1 AA), keyboard navigation, contrast ratios
- Ensure consistent spacing, clear labels, proper error handling
- Test edge cases and error conditions
- If you can't test interactively, analyze the code thoroughly
- Make commits that clearly describe the issues fixed

Focus areas:
- Visual consistency and hierarchy
- Keyboard accessibility
- Error handling and messaging
- Loading states and feedback
- Performance and responsiveness
- Code quality and maintainability

If you find NO issues, that's fine - just verify all requirements are met and mark as passed.`;

    // Run the agent
    for await (const message of query({
      prompt: agentPrompt,
      options: {
        // Fully autonomous mode
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,

        // Tools for comprehensive testing
        allowedTools: [
          "Read",
          "Write",
          "Edit",
          "Bash",
          "Glob",
          "Grep",
          "LSP",
        ],

        // System prompt
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: `You are a UI/UX quality assurance agent. Be extremely critical and thorough.
Your goal is to ensure the SpeakMCP application meets the highest standards of usability and accessibility.
Never skip testing edge cases. Never leave issues unfixed. Always commit your changes.`
        },

        // Load project settings
        settingSources: ["project"],

        // Working directory
        cwd: PROJECT_ROOT,

        // Limits to prevent runaway costs
        maxTurns: 50,
        maxBudgetUsd: 5,

        // Use Sonnet 4.5 for fast, accurate testing
        model: "claude-sonnet-4-5",
      }
    })) {
      if (message.type === "assistant") {
        const text = message.message.content[0]?.text;
        if (text) {
          log(`Agent: ${text.substring(0, 200)}...`);
        }
      } else if (message.type === "tool_result") {
        const toolName = message.tool_name;
        log(`Tool executed: ${toolName}`);

        // Track issues found and fixes applied
        if (toolName === "Edit" || toolName === "Write") {
          fixesApplied.push(`Modified file via ${toolName}`);
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          log(`\n${"=".repeat(80)}`);
          log(`SUCCESS: Agent completed flow #${flow.number}`);
          log(`Result: ${message.result}`);
          log(`Total cost: $${message.total_cost_usd}`);
          log(`Turns: ${message.num_turns}`);
          log(`${"=".repeat(80)}\n`);

          // Try to extract commit hash from recent commits
          try {
            const { execSync } = require("child_process");
            commitHash = execSync("git log -1 --format=%H", {
              cwd: PROJECT_ROOT,
              encoding: "utf-8"
            }).trim();
          } catch {
            // No commit made
          }

          // Determine if issues were found based on fixes applied
          const status = fixesApplied.length > 0 ? "fixed" : "passed";
          updateAuditResults(flow.number, status, issuesFound, fixesApplied, commitHash);
        } else {
          log(`ERROR: ${message.subtype}`);
          log(`Errors: ${message.errors?.join(", ")}`);
          updateAuditResults(flow.number, "failed", issuesFound, fixesApplied);
        }
      }
    }
  } catch (error) {
    log(`Fatal error during audit: ${error instanceof Error ? error.message : String(error)}`);
    updateAuditResults(flow.number, "failed", issuesFound, fixesApplied);
  }
}

/**
 * Main entry point
 */
async function main() {
  log("=== Autonomous UI/UX Audit Agent Started ===");

  // Find the next pending flow
  const nextFlow = findNextPendingFlow();

  if (!nextFlow) {
    log("No pending flows to test. Exiting.");
    return;
  }

  // Run the audit
  await runAuditAgent(nextFlow);

  log("\n=== Audit Agent Completed ===\n");
}

// Run the agent
main().catch((error) => {
  log(`Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
