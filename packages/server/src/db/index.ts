import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(dbPath?: string): Database.Database {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  
  const finalPath = dbPath || path.join(dataDir, 'speakmcp.db')
  
  db = new Database(finalPath)
  db.pragma('journal_mode = WAL')
  
  // Run migrations
  runMigrations(db)
  
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `)

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: '001_initial_schema',
      sql: `
        -- Configuration table (key-value store)
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
        );

        -- Profiles table
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          guidelines TEXT NOT NULL DEFAULT '',
          system_prompt TEXT,
          mcp_server_config TEXT, -- JSON
          model_config TEXT, -- JSON
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- Conversations table
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          metadata TEXT -- JSON
        );

        -- Conversation messages table
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          tool_calls TEXT, -- JSON
          tool_results TEXT, -- JSON
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        -- Message queue table
        CREATE TABLE IF NOT EXISTS message_queue (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'cancelled', 'failed')),
          created_at INTEGER NOT NULL,
          error_message TEXT,
          added_to_history INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        -- Agent sessions table
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          conversation_title TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'error', 'stopped')),
          is_snoozed INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          profile_snapshot TEXT, -- JSON
          error_message TEXT
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id 
          ON conversation_messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_message_queue_conversation_id 
          ON message_queue(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_message_queue_status 
          ON message_queue(status);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_status 
          ON agent_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation_id 
          ON agent_sessions(conversation_id);
      `,
    },
  ]

  const appliedMigrations = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  )

  const insertMigration = db.prepare('INSERT INTO migrations (name) VALUES (?)')

  for (const migration of migrations) {
    if (!appliedMigrations.has(migration.name)) {
      console.log(`Applying migration: ${migration.name}`)
      db.exec(migration.sql)
      insertMigration.run(migration.name)
    }
  }
}
