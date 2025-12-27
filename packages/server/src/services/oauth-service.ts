import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'

export const OAuthTokenSchema = z.object({
  id: z.string(),
  serverName: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  tokenType: z.string().default('Bearer'),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type OAuthToken = z.infer<typeof OAuthTokenSchema>

interface DbOAuthToken {
  id: string
  server_name: string
  access_token: string
  refresh_token: string | null
  token_type: string
  expires_at: number | null
  scope: string | null
  created_at: number
  updated_at: number
}

function dbRowToToken(row: DbOAuthToken): OAuthToken {
  return {
    id: row.id,
    serverName: row.server_name,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    tokenType: row.token_type,
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const oauthService = {
  /**
   * Get OAuth token for a server
   */
  getToken(serverName: string): OAuthToken | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM oauth_tokens WHERE server_name = ?')
      .get(serverName) as DbOAuthToken | undefined
    if (!row) return null
    return dbRowToToken(row)
  },

  /**
   * Check if token is expired or about to expire (within 5 minutes)
   */
  isTokenExpired(serverName: string): boolean {
    const token = this.getToken(serverName)
    if (!token) return true
    if (!token.expiresAt) return false // No expiry set
    
    const buffer = 5 * 60 * 1000 // 5 minutes buffer
    return Date.now() + buffer >= token.expiresAt
  },

  /**
   * Store or update OAuth token
   */
  storeToken(
    serverName: string,
    accessToken: string,
    options: {
      refreshToken?: string
      tokenType?: string
      expiresIn?: number // seconds until expiry
      scope?: string
    } = {}
  ): OAuthToken {
    const db = getDb()
    const now = Date.now()
    const id = `oauth_${nanoid()}`

    const expiresAt = options.expiresIn 
      ? now + (options.expiresIn * 1000)
      : null

    // Use INSERT OR REPLACE (upsert)
    db.prepare(`
      INSERT INTO oauth_tokens (id, server_name, access_token, refresh_token, token_type, expires_at, scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_name) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
        token_type = excluded.token_type,
        expires_at = excluded.expires_at,
        scope = COALESCE(excluded.scope, oauth_tokens.scope),
        updated_at = excluded.updated_at
    `).run(
      id,
      serverName,
      accessToken,
      options.refreshToken ?? null,
      options.tokenType ?? 'Bearer',
      expiresAt,
      options.scope ?? null,
      now,
      now
    )

    return this.getToken(serverName)!
  },

  /**
   * Delete OAuth token for a server
   */
  deleteToken(serverName: string): boolean {
    const db = getDb()
    const result = db.prepare('DELETE FROM oauth_tokens WHERE server_name = ?').run(serverName)
    return result.changes > 0
  },

  /**
   * List all stored tokens (without exposing actual token values)
   */
  listTokens(): Array<{
    serverName: string
    tokenType: string
    expiresAt?: number
    scope?: string
    isExpired: boolean
  }> {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM oauth_tokens ORDER BY server_name')
      .all() as DbOAuthToken[]

    return rows.map(row => ({
      serverName: row.server_name,
      tokenType: row.token_type,
      expiresAt: row.expires_at ?? undefined,
      scope: row.scope ?? undefined,
      isExpired: row.expires_at ? Date.now() >= row.expires_at : false,
    }))
  },

  /**
   * Clear all OAuth tokens
   */
  clearAllTokens(): number {
    const db = getDb()
    const result = db.prepare('DELETE FROM oauth_tokens').run()
    return result.changes
  },

  /**
   * Get the authorization header value for a server
   */
  getAuthHeader(serverName: string): string | null {
    const token = this.getToken(serverName)
    if (!token) return null
    return `${token.tokenType} ${token.accessToken}`
  },

  /**
   * Update the access token (e.g., after refresh)
   */
  updateAccessToken(
    serverName: string,
    accessToken: string,
    expiresIn?: number
  ): boolean {
    const db = getDb()
    const now = Date.now()
    const expiresAt = expiresIn ? now + (expiresIn * 1000) : null

    const result = db.prepare(`
      UPDATE oauth_tokens 
      SET access_token = ?, expires_at = ?, updated_at = ?
      WHERE server_name = ?
    `).run(accessToken, expiresAt, now, serverName)

    return result.changes > 0
  },
}

