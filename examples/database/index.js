#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseServer {
  constructor() {
    this.server = new Server(
      {
        name: "database-example",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.dbPath = path.join(__dirname, "example.db");
    this.db = null;
    this.setupToolHandlers();
  }

  async initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          // Create sample tables if they don't exist
          this.createSampleTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createSampleTables() {
    return new Promise((resolve, reject) => {
      const createTables = `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          completed BOOLEAN DEFAULT 0,
          user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        );

        INSERT OR IGNORE INTO users (id, name, email) VALUES 
          (1, 'John Doe', 'john@example.com'),
          (2, 'Jane Smith', 'jane@example.com');

        INSERT OR IGNORE INTO tasks (title, description, user_id) VALUES 
          ('Learn MCP', 'Study Model Context Protocol', 1),
          ('Build Example', 'Create database MCP server', 1),
          ('Test Integration', 'Test with SpeakMCP', 2);
      `;

      this.db.exec(createTables, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "query",
            description: "Execute a SELECT query on the database",
            inputSchema: {
              type: "object",
              properties: {
                sql: {
                  type: "string",
                  description: "SELECT SQL query to execute",
                },
              },
              required: ["sql"],
            },
          },
          {
            name: "execute",
            description: "Execute an INSERT, UPDATE, or DELETE statement",
            inputSchema: {
              type: "object",
              properties: {
                sql: {
                  type: "string",
                  description: "SQL statement to execute (INSERT, UPDATE, DELETE)",
                },
              },
              required: ["sql"],
            },
          },
          {
            name: "create_table",
            description: "Create a new table in the database",
            inputSchema: {
              type: "object",
              properties: {
                table_name: {
                  type: "string",
                  description: "Name of the table to create",
                },
                columns: {
                  type: "string",
                  description: "Column definitions (e.g., 'id INTEGER PRIMARY KEY, name TEXT')",
                },
              },
              required: ["table_name", "columns"],
            },
          },
          {
            name: "list_tables",
            description: "List all tables in the database",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "describe_table",
            description: "Show the structure of a table",
            inputSchema: {
              type: "object",
              properties: {
                table_name: {
                  type: "string",
                  description: "Name of the table to describe",
                },
              },
              required: ["table_name"],
            },
          },
          {
            name: "insert_data",
            description: "Insert data into a table",
            inputSchema: {
              type: "object",
              properties: {
                table_name: {
                  type: "string",
                  description: "Name of the table",
                },
                data: {
                  type: "object",
                  description: "Data to insert as key-value pairs",
                },
              },
              required: ["table_name", "data"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Initialize database if not already done
        if (!this.db) {
          await this.initializeDatabase();
        }

        switch (name) {
          case "query":
            return await this.executeQuery(args.sql);
          case "execute":
            return await this.executeStatement(args.sql);
          case "create_table":
            return await this.createTable(args.table_name, args.columns);
          case "list_tables":
            return await this.listTables();
          case "describe_table":
            return await this.describeTable(args.table_name);
          case "insert_data":
            return await this.insertData(args.table_name, args.data);
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

  // Validate SQL to prevent dangerous operations
  validateSQL(sql, allowedTypes = ["SELECT"]) {
    const trimmedSQL = sql.trim().toUpperCase();
    const sqlType = trimmedSQL.split(/\s+/)[0];
    
    if (!allowedTypes.includes(sqlType)) {
      throw new Error(`SQL type ${sqlType} not allowed. Allowed types: ${allowedTypes.join(", ")}`);
    }

    // Prevent dangerous keywords
    const dangerousKeywords = ["DROP", "TRUNCATE", "ALTER", "PRAGMA"];
    for (const keyword of dangerousKeywords) {
      if (trimmedSQL.includes(keyword)) {
        throw new Error(`Dangerous keyword '${keyword}' not allowed`);
      }
    }
  }

  async executeQuery(sql) {
    this.validateSQL(sql, ["SELECT"]);

    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const result = rows.length > 0 
            ? `Query returned ${rows.length} row(s):\n\n${JSON.stringify(rows, null, 2)}`
            : "Query returned no results.";

          resolve({
            content: [
              {
                type: "text",
                text: result,
              },
            ],
          });
        }
      });
    });
  }

  async executeStatement(sql) {
    this.validateSQL(sql, ["INSERT", "UPDATE", "DELETE"]);

    return new Promise((resolve, reject) => {
      this.db.run(sql, [], function(err) {
        if (err) {
          reject(err);
        } else {
          const message = sql.trim().toUpperCase().startsWith("INSERT")
            ? `Statement executed successfully. Inserted row ID: ${this.lastID}`
            : `Statement executed successfully. ${this.changes} row(s) affected.`;

          resolve({
            content: [
              {
                type: "text",
                text: message,
              },
            ],
          });
        }
      });
    });
  }

  async createTable(tableName, columns) {
    // Validate table name (alphanumeric and underscores only)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error("Invalid table name. Use only letters, numbers, and underscores.");
    }

    const sql = `CREATE TABLE ${tableName} (${columns})`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            content: [
              {
                type: "text",
                text: `Table '${tableName}' created successfully.`,
              },
            ],
          });
        }
      });
    });
  }

  async listTables() {
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";

    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const tables = rows.map(row => row.name);
          const result = tables.length > 0
            ? `Tables in database:\n\n${tables.map(t => `• ${t}`).join("\n")}`
            : "No tables found in database.";

          resolve({
            content: [
              {
                type: "text",
                text: result,
              },
            ],
          });
        }
      });
    });
  }

  async describeTable(tableName) {
    const sql = `PRAGMA table_info(${tableName})`;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else if (rows.length === 0) {
          reject(new Error(`Table '${tableName}' does not exist`));
        } else {
          const columns = rows.map(row => 
            `${row.name} (${row.type}${row.pk ? ', PRIMARY KEY' : ''}${row.notnull ? ', NOT NULL' : ''})`
          );
          
          resolve({
            content: [
              {
                type: "text",
                text: `Structure of table '${tableName}':\n\n${columns.join("\n")}`,
              },
            ],
          });
        }
      });
    });
  }

  async insertData(tableName, data) {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => "?").join(", ");
    const values = Object.values(data);
    
    const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, values, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            content: [
              {
                type: "text",
                text: `Data inserted successfully into '${tableName}'. Row ID: ${this.lastID}`,
              },
            ],
          });
        }
      });
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Database MCP server running on stdio");
  }
}

const server = new DatabaseServer();
server.run().catch(console.error);
