#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a safe sandbox directory
const SANDBOX_DIR = path.join(__dirname, "sandbox");

// Ensure sandbox directory exists
try {
  await fs.mkdir(SANDBOX_DIR, { recursive: true });
} catch (error) {
  // Directory might already exist
}

class FileSystemServer {
  constructor() {
    this.server = new Server(
      {
        name: "filesystem-example",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "read_file",
            description: "Read the contents of a file in the sandbox directory",
            inputSchema: {
              type: "object",
              properties: {
                filename: {
                  type: "string",
                  description: "Name of the file to read (relative to sandbox)",
                },
              },
              required: ["filename"],
            },
          },
          {
            name: "write_file",
            description: "Write content to a file in the sandbox directory",
            inputSchema: {
              type: "object",
              properties: {
                filename: {
                  type: "string",
                  description: "Name of the file to write (relative to sandbox)",
                },
                content: {
                  type: "string",
                  description: "Content to write to the file",
                },
              },
              required: ["filename", "content"],
            },
          },
          {
            name: "list_files",
            description: "List all files and directories in the sandbox",
            inputSchema: {
              type: "object",
              properties: {
                directory: {
                  type: "string",
                  description: "Directory to list (relative to sandbox, defaults to root)",
                  default: ".",
                },
              },
            },
          },
          {
            name: "create_directory",
            description: "Create a new directory in the sandbox",
            inputSchema: {
              type: "object",
              properties: {
                dirname: {
                  type: "string",
                  description: "Name of the directory to create (relative to sandbox)",
                },
              },
              required: ["dirname"],
            },
          },
          {
            name: "delete_file",
            description: "Delete a file from the sandbox directory",
            inputSchema: {
              type: "object",
              properties: {
                filename: {
                  type: "string",
                  description: "Name of the file to delete (relative to sandbox)",
                },
              },
              required: ["filename"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "read_file":
            return await this.readFile(args.filename);
          case "write_file":
            return await this.writeFile(args.filename, args.content);
          case "list_files":
            return await this.listFiles(args.directory || ".");
          case "create_directory":
            return await this.createDirectory(args.dirname);
          case "delete_file":
            return await this.deleteFile(args.filename);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // Validate and resolve path within sandbox
  resolveSafePath(relativePath) {
    const fullPath = path.resolve(SANDBOX_DIR, relativePath);
    const rel = path.relative(SANDBOX_DIR, fullPath);
    // reject if it escapes (".." or absolute outside)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Path outside sandbox directory not allowed');
    }
    return fullPath;
  }

  async readFile(filename) {
    const filePath = this.resolveSafePath(filename);
    const content = await fs.readFile(filePath, "utf-8");
    return {
      content: [
        {
          type: "text",
          text: `File: ${filename}\n\n${content}`,
        },
      ],
    };
  }

  async writeFile(filename, content) {
    const filePath = this.resolveSafePath(filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return {
      content: [
        {
          type: "text",
          text: `Successfully wrote ${content.length} characters to ${filename}`,
        },
      ],
    };
  }

  async listFiles(directory) {
    const dirPath = this.resolveSafePath(directory);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    const fileList = entries.map(entry => {
      const type = entry.isDirectory() ? "📁" : "📄";
      return `${type} ${entry.name}`;
    }).join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Contents of ${directory}:\n\n${fileList || "Empty directory"}`,
        },
      ],
    };
  }

  async createDirectory(dirname) {
    const dirPath = this.resolveSafePath(dirname);
    await fs.mkdir(dirPath, { recursive: true });
    return {
      content: [
        {
          type: "text",
          text: `Successfully created directory: ${dirname}`,
        },
      ],
    };
  }

  async deleteFile(filename) {
    const filePath = this.resolveSafePath(filename);
    await fs.unlink(filePath);
    return {
      content: [
        {
          type: "text",
          text: `Successfully deleted file: ${filename}`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Filesystem MCP server running on stdio");
  }
}

const server = new FileSystemServer();
server.run().catch(console.error);
