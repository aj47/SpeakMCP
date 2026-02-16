#!/usr/bin/env tsx
/**
 * Audit Agent Scheduler
 *
 * Runs the autonomous UI/UX audit agent every 30 minutes
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..");
const AGENT_SCRIPT = path.join(__dirname, "audit-agent.ts");
const SCHEDULER_LOG = path.join(PROJECT_ROOT, "audit-scheduler.log");

/**
 * Log to console and file
 */
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(SCHEDULER_LOG, logMessage + "\n");
}

/**
 * Run the audit agent script
 */
function runAuditAgent(): Promise<void> {
  return new Promise((resolve) => {
    log("Starting audit agent...");

    const agent = spawn("tsx", [AGENT_SCRIPT], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0", // Disable colors in child process
      },
    });

    agent.stdout?.on("data", (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(output);
      }
    });

    agent.stderr?.on("data", (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error(output);
      }
    });

    agent.on("close", (code) => {
      if (code === 0) {
        log("Audit agent completed successfully");
      } else {
        log(`Audit agent exited with code ${code}`);
      }
      resolve();
    });

    agent.on("error", (error) => {
      log(`Error running audit agent: ${error.message}`);
      resolve();
    });
  });
}

/**
 * Schedule the next run
 */
function scheduleNextRun() {
  const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds

  log(`Next run scheduled in 30 minutes (${new Date(Date.now() + thirtyMinutes).toISOString()})`);

  setTimeout(async () => {
    await runAuditAgent();
    scheduleNextRun(); // Schedule the next run
  }, thirtyMinutes);
}

/**
 * Main entry point
 */
async function main() {
  log("=== Audit Agent Scheduler Started ===");
  log("Running audit agent every 30 minutes");
  log("Press Ctrl+C to stop\n");

  // Run immediately on startup
  await runAuditAgent();

  // Schedule subsequent runs
  scheduleNextRun();
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("\n=== Scheduler shutting down gracefully ===");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("\n=== Scheduler terminated ===");
  process.exit(0);
});

// Start the scheduler
main().catch((error) => {
  log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
