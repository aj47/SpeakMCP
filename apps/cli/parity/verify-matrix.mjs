#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");
const matrixPath = path.resolve(__dirname, "parity-matrix.json");

function fail(message) {
  console.error(`[parity:matrix:verify] ${message}`);
  process.exitCode = 1;
}

function hashFile(absPath) {
  const content = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function summarizeByStatus(rows) {
  const summary = new Map();
  for (const row of rows) {
    summary.set(row.status, (summary.get(row.status) || 0) + 1);
  }
  return summary;
}

if (!fs.existsSync(matrixPath)) {
  fail(`Matrix file missing: ${matrixPath}`);
  process.exit(process.exitCode || 1);
}

let matrix;
try {
  matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
} catch (error) {
  fail(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(process.exitCode || 1);
}

const requiredTopLevel = ["version", "updatedAt", "statusEnum", "sourceOfTruth", "sourceHashes", "rows"];
for (const key of requiredTopLevel) {
  if (!(key in matrix)) {
    fail(`Missing top-level key: ${key}`);
  }
}

if (!Array.isArray(matrix.rows) || matrix.rows.length === 0) {
  fail("rows must be a non-empty array");
}

if (!Array.isArray(matrix.statusEnum) || matrix.statusEnum.length === 0) {
  fail("statusEnum must be a non-empty array");
}

const statusSet = new Set(matrix.statusEnum);
const requiredRowKeys = [
  "id",
  "feature",
  "priority",
  "desktopSurface",
  "serverSurface",
  "cliSurface",
  "status",
  "parityType",
  "notes",
];

const seenIds = new Set();
for (const row of matrix.rows || []) {
  for (const key of requiredRowKeys) {
    if (!(key in row)) {
      fail(`Row ${row.id || "<unknown>"} missing key: ${key}`);
    }
  }

  if (seenIds.has(row.id)) {
    fail(`Duplicate row id: ${row.id}`);
  }
  seenIds.add(row.id);

  if (!statusSet.has(row.status)) {
    fail(`Row ${row.id} has invalid status: ${row.status}`);
  }

  if (row.parityType !== "direct" && row.parityType !== "terminal_equivalent") {
    fail(`Row ${row.id} has invalid parityType: ${row.parityType}`);
  }
}

const watchFiles = matrix.sourceOfTruth?.watchFiles;
if (!Array.isArray(watchFiles) || watchFiles.length === 0) {
  fail("sourceOfTruth.watchFiles must be a non-empty array");
}

for (const relPath of watchFiles || []) {
  const absPath = path.resolve(repoRoot, relPath);
  if (!fs.existsSync(absPath)) {
    fail(`Watch file does not exist: ${relPath}`);
    continue;
  }

  const expectedHash = matrix.sourceHashes?.[relPath];
  if (!expectedHash) {
    fail(`Missing source hash entry for watch file: ${relPath}`);
    continue;
  }

  const actualHash = hashFile(absPath);
  if (actualHash !== expectedHash) {
    fail(
      `Stale matrix detected for ${relPath}\n` +
        `  expected: ${expectedHash}\n` +
        `  actual:   ${actualHash}\n` +
        `  hint: update parity-matrix.json sourceHashes after reviewing row statuses`
    );
  }
}

const summary = summarizeByStatus(matrix.rows || []);
if (process.exitCode) {
  console.error("[parity:matrix:verify] FAILED");
  process.exit(process.exitCode);
}

console.log("[parity:matrix:verify] Matrix is valid and source hashes are current.");
for (const [status, count] of summary.entries()) {
  console.log(`  - ${status}: ${count}`);
}
