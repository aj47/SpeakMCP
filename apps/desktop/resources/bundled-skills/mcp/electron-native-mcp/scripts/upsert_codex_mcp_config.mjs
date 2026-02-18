#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function tomlEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function findNamedDirectory(root, names, maxDepth = 4) {
  const skipDirs = new Set([
    ".git",
    "node_modules",
    ".pnpm-store",
    ".yarn",
    ".cache",
    "Library",
    "Applications",
    "Movies",
    "Pictures",
    "Music",
    "Downloads",
  ]);

  function walk(currentPath, depth) {
    if (depth > maxDepth || !dirExists(currentPath)) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      if (names.has(entry.name)) return fullPath;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      const found = walk(fullPath, depth + 1);
      if (found) return found;
    }
    return null;
  }

  return walk(root, 0);
}

function resolveScriptPath(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    return fileExists(resolved) ? resolved : null;
  }

  const home = os.homedir();
  const envPath = process.env.ELECTRON_NATIVE_MCP_SCRIPT_PATH;
  const directCandidates = [
    envPath,
    path.join(home, "Development", "electron-native-mcp", "dist", "index.js"),
    path.join(home, "Development", "electron-mcp-server", "dist", "index.js"),
    path.join(home, "electron-native-mcp", "dist", "index.js"),
    path.join(home, "electron-mcp-server", "dist", "index.js"),
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    const resolved = path.resolve(candidate);
    if (fileExists(resolved)) return resolved;
  }

  const searchRoots = [path.join(home, "Development"), process.cwd()];
  const targetNames = new Set(["electron-native-mcp", "electron-mcp-server"]);
  for (const searchRoot of searchRoots) {
    const foundDir = findNamedDirectory(searchRoot, targetNames, 4);
    if (!foundDir) continue;
    const candidate = path.join(foundDir, "dist", "index.js");
    if (fileExists(candidate)) return candidate;
  }

  return null;
}

function removeTargetSection(lines, sectionHeader) {
  const output = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== sectionHeader) {
      output.push(line);
      continue;
    }

    i += 1;
    while (i < lines.length) {
      const current = lines[i];
      if (current.startsWith("[")) {
        i -= 1;
        break;
      }
      i += 1;
    }
  }
  return output;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(String(args["config-path"] || path.join(os.homedir(), ".codex", "config.toml")));
  const serverName = String(args["server-name"] || "electron-native");
  const command = String(args.command || "node");
  const scriptPath = resolveScriptPath(args["script-path"]);

  if (!scriptPath) {
    console.error("Could not find dist/index.js for electron-native MCP.");
    console.error("Provide --script-path /absolute/path/to/dist/index.js");
    process.exit(1);
  }

  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, "", "utf8");
  }

  const original = fs.readFileSync(configPath, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const sectionHeader = `[mcp_servers.${serverName}]`;
  const lines = original.split(/\r?\n/);
  const withoutSection = removeTargetSection(lines, sectionHeader);

  while (withoutSection.length > 0 && withoutSection[withoutSection.length - 1].trim() === "") {
    withoutSection.pop();
  }
  if (withoutSection.length > 0) {
    withoutSection.push("");
  }

  withoutSection.push(sectionHeader);
  withoutSection.push(`command = "${tomlEscape(command)}"`);
  withoutSection.push(`args = ["${tomlEscape(scriptPath)}"]`);

  const updated = `${withoutSection.join(newline)}${newline}`;
  fs.writeFileSync(configPath, updated, "utf8");

  console.log(`Updated ${configPath}`);
  console.log(sectionHeader);
  console.log(`command = "${command}"`);
  console.log(`args = ["${scriptPath}"]`);
}

main();
