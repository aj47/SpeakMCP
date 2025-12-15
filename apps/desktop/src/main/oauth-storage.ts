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
  // In-memory cache to avoid repeated keychain access (which triggers macOS password prompts)
  private cachedData: StoredOAuthData | null = null
  private cacheLoaded: boolean = false
  // Shared promise to deduplicate concurrent loadAll() calls during startup
  private loadPromise: Promise<StoredOAuthData> | null = null
  // Track if load failed (e.g., user cancelled keychain prompt) to prevent data loss
  // When set, saveAll() will refuse to write to prevent overwriting existing data
  private loadFailedError: Error | null = null

  constructor() {
    this.initializeEncryption()
  }

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
      this.encryptionKey = crypto.randomBytes(32)
    }
  }

  private encryptData(data: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(data)
      return JSON.stringify({
        method: 'safeStorage',
        data: encrypted.toString('base64'),
      })
    } else {
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

  async loadAll(): Promise<StoredOAuthData> {
    // Return cached data if available (avoids repeated keychain prompts on macOS)
    if (this.cacheLoaded && this.cachedData !== null) {
      return this.cachedData
    }

    // If a load is already in progress, wait for it to complete
    // This prevents multiple concurrent keychain prompts during startup
    if (this.loadPromise !== null) {
      return this.loadPromise
    }

    // Start loading and store the promise so concurrent callers share it
    this.loadPromise = this.performLoad()

    try {
      return await this.loadPromise
    } finally {
      // Clear the promise after completion so future loads can start fresh if needed
      this.loadPromise = null
    }
  }

  private async performLoad(): Promise<StoredOAuthData> {
    try {
      if (!fs.existsSync(OAUTH_STORAGE_FILE)) {
        this.cachedData = {}
        this.cacheLoaded = true
        return this.cachedData
      }

      const encryptedData = fs.readFileSync(OAUTH_STORAGE_FILE, 'utf8')
      const decryptedData = this.decryptData(encryptedData)
      this.cachedData = JSON.parse(decryptedData) as StoredOAuthData
      this.cacheLoaded = true
      return this.cachedData
    } catch (error) {
      // On load failure (e.g., user cancelled keychain prompt, corrupted data):
      // - Set loadFailedError to track the failure state
      // - Cache empty data for reads (graceful degradation - app can still function)
      // - saveAll() will refuse to write when loadFailedError is set, preventing data loss
      // - Call invalidateCache() to clear the error and allow retry
      const loadError = error instanceof Error ? error : new Error(String(error))
      this.loadFailedError = loadError
      this.cachedData = {}
      this.cacheLoaded = true
      return this.cachedData
    }
  }

  async saveAll(data: StoredOAuthData): Promise<void> {
    // Prevent writes if initial load failed to avoid overwriting existing data
    // This protects against data loss when user cancels keychain prompt
    if (this.loadFailedError) {
      throw new Error(
        `Cannot save OAuth data: initial load failed (${this.loadFailedError.message}). ` +
        `Call invalidateCache() to retry loading before saving.`
      )
    }

    try {
      fs.mkdirSync(dataFolder, { recursive: true })
      const jsonData = JSON.stringify(data, null, 2)
      const encryptedData = this.encryptData(jsonData)
      fs.writeFileSync(OAUTH_STORAGE_FILE, encryptedData, { mode: 0o600 })
      // Update cache after successful save
      this.cachedData = data
      this.cacheLoaded = true
    } catch (error) {
      throw new Error(`Failed to save OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Invalidate the in-memory cache, forcing next loadAll() to read from disk.
   * Also clears any load failure state, allowing retry after a failed load.
   * Use sparingly - this will trigger a keychain prompt on macOS.
   */
  invalidateCache(): void {
    this.cachedData = null
    this.cacheLoaded = false
    this.loadPromise = null
    this.loadFailedError = null
  }

  /**
   * Check if the last load attempt failed (e.g., user cancelled keychain prompt).
   * When true, save operations will fail to prevent data loss.
   * Call invalidateCache() to clear this state and retry loading.
   */
  hasLoadFailed(): boolean {
    return this.loadFailedError !== null
  }

  /**
   * Get the error from the last failed load attempt, or null if no failure.
   */
  getLoadError(): Error | null {
    return this.loadFailedError
  }

  async load(serverUrl: string): Promise<OAuthConfig | null> {
    const allData = await this.loadAll()
    const serverData = allData[serverUrl]
    return serverData ? serverData.config : null
  }

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
    oauthStorage.cleanup().catch(() => {})
  }, 60 * 60 * 1000)

  // Initial cleanup
  oauthStorage.cleanup().catch(() => {})
})
