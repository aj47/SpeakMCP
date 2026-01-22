/**
 * models.dev API Client Service
 * 
 * Fetches and caches model data from the models.dev API.
 * Provides functions to query models by provider and model ID.
 */

import fs from "fs"
import path from "path"
import { app } from "electron"
import { diagnosticsService } from "./diagnostics"

// ============================================================================
// Types
// ============================================================================

/** Cost information for a model (in USD per million tokens) */
export interface ModelsDevCost {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
  reasoning?: number
  input_audio?: number
  output_audio?: number
}

/** Context/output limits for a model */
export interface ModelsDevLimit {
  context: number
  output: number
}

/** Input/output modalities supported by the model */
export interface ModelsDevModalities {
  input: string[]
  output: string[]
}

/** Model definition from models.dev API */
export interface ModelsDevModel {
  id: string
  name: string
  family?: string
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  temperature?: boolean
  knowledge?: string
  release_date?: string
  last_updated?: string
  modalities?: ModelsDevModalities
  open_weights?: boolean
  cost?: ModelsDevCost
  limit?: ModelsDevLimit
  interleaved?: { field: string }
}

/** Provider definition from models.dev API */
export interface ModelsDevProvider {
  id: string
  name: string
  env?: string[]
  npm?: string
  api?: string
  doc?: string
  models: Record<string, ModelsDevModel>
}

/** Full API response: Record of provider ID to provider data */
export type ModelsDevData = Record<string, ModelsDevProvider>

/** Cache file structure */
interface ModelsDevCache {
  timestamp: number
  data: ModelsDevData
}

// ============================================================================
// Constants
// ============================================================================

const MODELS_DEV_API_URL = "https://models.dev/api.json"
const CACHE_FILENAME = "models-dev-cache.json"
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

// ============================================================================
// Internal State
// ============================================================================

let inMemoryCache: ModelsDevData | null = null
let lastFetchTimestamp = 0

// ============================================================================
// Helper Functions
// ============================================================================

function getCachePath(): string {
  const userDataPath = app.getPath("userData")
  return path.join(userDataPath, CACHE_FILENAME)
}

function readCacheFromDisk(): ModelsDevCache | null {
  try {
    const cachePath = getCachePath()
    if (!fs.existsSync(cachePath)) {
      return null
    }
    const cacheContent = fs.readFileSync(cachePath, "utf-8")
    return JSON.parse(cacheContent) as ModelsDevCache
  } catch (error) {
    diagnosticsService.logError(
      "models-dev-service",
      "Failed to read cache from disk",
      error
    )
    return null
  }
}

function writeCacheToDisk(data: ModelsDevData): void {
  try {
    const cachePath = getCachePath()
    const cache: ModelsDevCache = {
      timestamp: Date.now(),
      data,
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8")
    diagnosticsService.logInfo(
      "models-dev-service",
      `Cache written to disk: ${cachePath}`
    )
  } catch (error) {
    diagnosticsService.logError(
      "models-dev-service",
      "Failed to write cache to disk",
      error
    )
  }
}

async function fetchFromApi(): Promise<ModelsDevData> {
  diagnosticsService.logInfo(
    "models-dev-service",
    `Fetching models from ${MODELS_DEV_API_URL}`
  )

  const response = await fetch(MODELS_DEV_API_URL)

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json() as ModelsDevData

  const providerCount = Object.keys(data).length
  const modelCount = Object.values(data).reduce(
    (sum, provider) => sum + Object.keys(provider.models || {}).length,
    0
  )

  diagnosticsService.logInfo(
    "models-dev-service",
    `Fetched ${providerCount} providers with ${modelCount} total models`
  )

  return data
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_REFRESH_INTERVAL
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch models.dev data, using cache when available.
 *
 * Priority:
 * 1. In-memory cache (if valid)
 * 2. Disk cache (if valid)
 * 3. Fresh fetch from API (falls back to disk cache on error)
 */
export async function fetchModelsDevData(): Promise<ModelsDevData> {
  // Check in-memory cache first
  if (inMemoryCache && isCacheValid(lastFetchTimestamp)) {
    diagnosticsService.logInfo(
      "models-dev-service",
      "Returning data from in-memory cache"
    )
    return inMemoryCache
  }

  // Check disk cache
  const diskCache = readCacheFromDisk()
  if (diskCache && isCacheValid(diskCache.timestamp)) {
    diagnosticsService.logInfo(
      "models-dev-service",
      "Returning data from disk cache"
    )
    inMemoryCache = diskCache.data
    lastFetchTimestamp = diskCache.timestamp
    return diskCache.data
  }

  // Fetch fresh data from API
  try {
    const data = await fetchFromApi()

    // Update caches
    inMemoryCache = data
    lastFetchTimestamp = Date.now()
    writeCacheToDisk(data)

    return data
  } catch (error) {
    diagnosticsService.logError(
      "models-dev-service",
      "Failed to fetch from API, falling back to cached data",
      error
    )

    // Fallback to disk cache (even if expired)
    if (diskCache) {
      diagnosticsService.logInfo(
        "models-dev-service",
        "Using expired disk cache as fallback"
      )
      inMemoryCache = diskCache.data
      lastFetchTimestamp = diskCache.timestamp
      return diskCache.data
    }

    // No cache available
    throw new Error(
      `Failed to fetch models.dev data and no cache available: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get a specific model by provider ID and model ID.
 *
 * @param modelId - The model ID (e.g., "gpt-4o", "claude-sonnet-4")
 * @param providerId - The provider ID (e.g., "openai", "anthropic", "openrouter")
 * @returns The model data or undefined if not found
 */
export function getModelFromModelsDevByProviderId(
  modelId: string,
  providerId: string
): ModelsDevModel | undefined {
  if (!inMemoryCache) {
    diagnosticsService.logInfo(
      "models-dev-service",
      "Cache not loaded, cannot lookup model synchronously"
    )
    return undefined
  }

  const provider = inMemoryCache[providerId]
  if (!provider) {
    return undefined
  }

  return provider.models?.[modelId]
}

/**
 * Force refresh the cache from the API.
 * Useful for manual refresh or when stale data is suspected.
 */
export async function refreshModelsDevCache(): Promise<void> {
  diagnosticsService.logInfo(
    "models-dev-service",
    "Force refreshing cache from API"
  )

  try {
    const data = await fetchFromApi()
    inMemoryCache = data
    lastFetchTimestamp = Date.now()
    writeCacheToDisk(data)

    diagnosticsService.logInfo(
      "models-dev-service",
      "Cache successfully refreshed"
    )
  } catch (error) {
    diagnosticsService.logError(
      "models-dev-service",
      "Failed to refresh cache",
      error
    )
    throw error
  }
}

/**
 * Initialize the models.dev service.
 * Call this on app startup to trigger background refresh if needed.
 * This function does not block - it triggers a background fetch if cache is stale.
 */
export function initModelsDevService(): void {
  diagnosticsService.logInfo(
    "models-dev-service",
    "Initializing models.dev service"
  )

  // Load disk cache into memory if available
  const diskCache = readCacheFromDisk()
  if (diskCache) {
    inMemoryCache = diskCache.data
    lastFetchTimestamp = diskCache.timestamp
    diagnosticsService.logInfo(
      "models-dev-service",
      `Loaded cache from disk (age: ${Math.round((Date.now() - diskCache.timestamp) / 1000 / 60)} minutes)`
    )
  }

  // Trigger background refresh if cache is stale or missing
  if (!diskCache || !isCacheValid(diskCache.timestamp)) {
    diagnosticsService.logInfo(
      "models-dev-service",
      "Cache is stale or missing, triggering background refresh"
    )

    // Fire and forget - don't block startup
    fetchModelsDevData().catch((error) => {
      diagnosticsService.logError(
        "models-dev-service",
        "Background refresh failed",
        error
      )
    })
  }
}

