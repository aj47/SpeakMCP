/**
 * Secure OAuth Token Storage for Electron
 * 
 * Provides secure storage for OAuth tokens and client credentials
 * using Electron's safeStorage API when available, with fallback
 * to encrypted file storage.
 */

import { app, safeStorage } from "electron"
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { OAuthConfig, OAuthTokens } from "@shared/types"
import { dataFolder } from "./config"

const OAUTH_STORAGE_FILE = path.join(dataFolder, "oauth-storage.json")
const ENCRYPTION_KEY_FILE = path.join(dataFolder, ".oauth-key")

export interface StoredOAuthData {
  [serverUrl: string]: {
    config: OAuthConfig
    lastUpdated: number
  }
}

export class OAuthStorage {
  private encryptionKey: Buffer | null = null

  constructor() {
    this.initializeEncryption()
  }

  /**
   * Initialize encryption key for fallback storage
   */
  private initializeEncryption(): void {
    try {
      if (fs.existsSync(ENCRYPTION_KEY_FILE)) {
        this.encryptionKey = fs.readFileSync(ENCRYPTION_KEY_FILE)
      } else {
        this.encryptionKey = crypto.randomBytes(32)
        fs.mkdirSync(dataFolder, { recursive: true })
        fs.writeFileSync(ENCRYPTION_KEY_FILE, this.encryptionKey, { mode: 0o600 })
      }
    } catch (error) {
      console.error('Failed to initialize OAuth encryption key:', error)
      this.encryptionKey = crypto.randomBytes(32) // Use in-memory key as fallback
    }
  }

  /**
   * Encrypt data using Electron's safeStorage or fallback encryption
   */
  private encryptData(data: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(data)
      return JSON.stringify({
        method: 'safeStorage',
        data: encrypted.toString('base64'),
      })
    } else {
      // Fallback to AES encryption
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey!)
      let encrypted = cipher.update(data, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      const authTag = cipher.getAuthTag()

      return JSON.stringify({
        method: 'aes',
        data: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
      })
    }
  }

  /**
   * Decrypt data using appropriate method
   */
  private decryptData(encryptedData: string): string {
    try {
      const parsed = JSON.parse(encryptedData)

      if (parsed.method === 'safeStorage') {
        const buffer = Buffer.from(parsed.data, 'base64')
        return safeStorage.decryptString(buffer)
      } else if (parsed.method === 'aes') {
        const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey!)
        decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'))
        let decrypted = decipher.update(parsed.data, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return decrypted
      } else {
        throw new Error('Unknown encryption method')
      }
    } catch (error) {
      throw new Error(`Failed to decrypt OAuth data: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Load all stored OAuth configurations
   */
  async loadAll(): Promise<StoredOAuthData> {
    try {
      if (!fs.existsSync(OAUTH_STORAGE_FILE)) {
        return {}
      }

      const encryptedData = fs.readFileSync(OAUTH_STORAGE_FILE, 'utf8')
      const decryptedData = this.decryptData(encryptedData)
      return JSON.parse(decryptedData) as StoredOAuthData
    } catch (error) {
      console.error('Failed to load OAuth storage:', error)
      return {}
    }
  }

  /**
   * Save all OAuth configurations
   */
  async saveAll(data: StoredOAuthData): Promise<void> {
    try {
      fs.mkdirSync(dataFolder, { recursive: true })
      const jsonData = JSON.stringify(data, null, 2)
      const encryptedData = this.encryptData(jsonData)
      fs.writeFileSync(OAUTH_STORAGE_FILE, encryptedData, { mode: 0o600 })
    } catch (error) {
      throw new Error(`Failed to save OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Load OAuth configuration for a specific server
   */
  async load(serverUrl: string): Promise<OAuthConfig | null> {
    const allData = await this.loadAll()
    const serverData = allData[serverUrl]
    return serverData ? serverData.config : null
  }

  /**
   * Save OAuth configuration for a specific server
   */
  async save(serverUrl: string, config: OAuthConfig): Promise<void> {
    const allData = await this.loadAll()
    allData[serverUrl] = {
      config,
      lastUpdated: Date.now(),
    }
    await this.saveAll(allData)
  }

  /**
   * Delete OAuth configuration for a specific server
   */
  async delete(serverUrl: string): Promise<void> {
    const allData = await this.loadAll()
    delete allData[serverUrl]
    await this.saveAll(allData)
  }

  /**
   * Store tokens for a specific server
   */
  async storeTokens(serverUrl: string, tokens: OAuthTokens): Promise<void> {
    const config = await this.load(serverUrl) || {}
    config.tokens = tokens
    await this.save(serverUrl, config)
  }

  /**
   * Get tokens for a specific server
   */
  async getTokens(serverUrl: string): Promise<OAuthTokens | null> {
    const config = await this.load(serverUrl)
    return config?.tokens || null
  }

  /**
   * Clear tokens for a specific server
   */
  async clearTokens(serverUrl: string): Promise<void> {
    const config = await this.load(serverUrl)
    if (config) {
      delete config.tokens
      await this.save(serverUrl, config)
    }
  }

  /**
   * Check if tokens exist and are not expired for a server
   */
  async hasValidTokens(serverUrl: string): Promise<boolean> {
    const tokens = await this.getTokens(serverUrl)
    if (!tokens?.access_token) {
      return false
    }

    if (tokens.expires_at && Date.now() >= tokens.expires_at) {
      return false
    }

    return true
  }

  /**
   * Clean up expired tokens and old configurations
   */
  async cleanup(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    const allData = await this.loadAll()
    const now = Date.now()
    let hasChanges = false

    for (const [serverUrl, serverData] of Object.entries(allData)) {
      // Remove old configurations
      if (now - serverData.lastUpdated > maxAge) {
        delete allData[serverUrl]
        hasChanges = true
        continue
      }

      // Remove expired tokens
      const tokens = serverData.config.tokens
      if (tokens?.expires_at && now >= tokens.expires_at && !tokens.refresh_token) {
        delete serverData.config.tokens
        hasChanges = true
      }
    }

    if (hasChanges) {
      await this.saveAll(allData)
    }
  }

  /**
   * Get all server URLs with stored OAuth configurations
   */
  async getStoredServers(): Promise<string[]> {
    const allData = await this.loadAll()
    return Object.keys(allData)
  }

  /**
   * Export OAuth configurations (without sensitive tokens)
   */
  async exportConfigs(): Promise<Record<string, Omit<OAuthConfig, 'tokens'>>> {
    const allData = await this.loadAll()
    const exported: Record<string, Omit<OAuthConfig, 'tokens'>> = {}

    for (const [serverUrl, serverData] of Object.entries(allData)) {
      const { tokens, ...configWithoutTokens } = serverData.config
      exported[serverUrl] = configWithoutTokens
    }

    return exported
  }

  /**
   * Import OAuth configurations
   */
  async importConfigs(configs: Record<string, Omit<OAuthConfig, 'tokens'>>): Promise<void> {
    const allData = await this.loadAll()

    for (const [serverUrl, config] of Object.entries(configs)) {
      const existingData = allData[serverUrl]
      allData[serverUrl] = {
        config: {
          ...config,
          // Preserve existing tokens if any
          tokens: existingData?.config.tokens,
        },
        lastUpdated: Date.now(),
      }
    }

    await this.saveAll(allData)
  }
}

// Singleton instance
export const oauthStorage = new OAuthStorage()

// Initialize cleanup on app ready
app.whenReady().then(() => {
  // Clean up expired tokens every hour
  setInterval(() => {
    oauthStorage.cleanup().catch(console.error)
  }, 60 * 60 * 1000)

  // Initial cleanup
  oauthStorage.cleanup().catch(console.error)
})
