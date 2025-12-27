import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let sqlJsDb: SqlJsDatabase | null = null
let dbPath: string | null = null

// Wrapper to provide a similar API
export interface Database {
  prepare(sql: string): Statement
  exec(sql: string): void
  close(): void
}

export interface Statement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

class SqlJsStatement implements Statement {
  constructor(private db: SqlJsDatabase, private sql: string) {}

  run(...params: unknown[]): { changes: number } {
    this.db.run(this.sql, params as any[])
    saveDatabase()
    return { changes: this.db.getRowsModified() }
  }

  get(...params: unknown[]): unknown {
    const stmt = this.db.prepare(this.sql)
    stmt.bind(params as any[])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return row
    }
    stmt.free()
    return undefined
  }

  all(...params: unknown[]): unknown[] {
    const results: unknown[] = []
    const stmt = this.db.prepare(this.sql)
    stmt.bind(params as any[])
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }
}

class SqlJsDatabaseWrapper implements Database {
  constructor(private sqlJsDb: SqlJsDatabase) {}

  prepare(sql: string): Statement {
    return new SqlJsStatement(this.sqlJsDb, sql)
  }

  exec(sql: string): void {
    this.sqlJsDb.exec(sql)
    saveDatabase()
  }

  close(): void {
    this.sqlJsDb.close()
  }
}

let db: Database | null = null

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

function saveDatabase(): void {
  if (sqlJsDb && dbPath && dbPath !== ':memory:') {
    const data = sqlJsDb.export()
    const buffer = Buffer.from(data)
    writeFileSync(dbPath, buffer)
  }
}

export async function initDatabase(customDbPath?: string): Promise<void> {
  const databasePath = customDbPath ?? config.databasePath
  dbPath = databasePath

  const SQL = await initSqlJs()

  // Handle in-memory database for tests
  if (databasePath === ':memory:') {
    sqlJsDb = new SQL.Database()
  } else {
    const dbDir = dirname(databasePath)
    mkdirSync(dbDir, { recursive: true })

    // Load existing database or create new one
    if (existsSync(databasePath)) {
      const fileBuffer = readFileSync(databasePath)
      sqlJsDb = new SQL.Database(fileBuffer)
    } else {
      sqlJsDb = new SQL.Database()
    }
  }

  db = new SqlJsDatabaseWrapper(sqlJsDb)

  // Enable foreign keys (WAL not supported in sql.js)
  sqlJsDb.run('PRAGMA foreign_keys = ON')

  // Run schema
  const schemaPath = join(__dirname, 'schema.sql')
  const schema = readFileSync(schemaPath, 'utf-8')
  db.exec(schema)

  console.log(`Database initialized at ${databasePath}`)
}

export function closeDatabase(): void {
  if (sqlJsDb) {
    saveDatabase()
    sqlJsDb.close()
    sqlJsDb = null
    db = null
    dbPath = null
  }
}

export function resetDatabase(): void {
  if (db) {
    // Drop all tables and recreate
    db.exec(`
      DROP TABLE IF EXISTS error_log;
      DROP TABLE IF EXISTS oauth_tokens;
      DROP TABLE IF EXISTS agent_sessions;
      DROP TABLE IF EXISTS message_queue;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS profiles;
      DROP TABLE IF EXISTS app_state;
      DROP TABLE IF EXISTS config
    `)

    // Re-run schema
    const schemaPath = join(__dirname, 'schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    db.exec(schema)
  }
}

