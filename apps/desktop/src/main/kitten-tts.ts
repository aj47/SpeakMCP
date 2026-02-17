/**
 * Kitten TTS Service
 *
 * Provides local text-to-speech synthesis using the Kitten model
 * via sherpa-onnx. Handles model download, extraction, and synthesis.
 *
 * Note: The sherpa-onnx-node package requires platform-specific native libraries.
 * This module uses dynamic imports and configures library paths before loading.
 */

import { app } from "electron"
import * as fs from "fs"
import * as path from "path"
import * as https from "https"
import * as os from "os"
import { pipeline } from "stream/promises"

// tar is an optional dependency, loaded dynamically when needed
// We use the Unpack class for streaming extraction with bz2 decompression
type TarUnpack = import("tar").Unpack
type TarUnpackOptions = {
  cwd: string
  filter?: (path: string, entry: unknown) => boolean
}
type TarModule = {
  x: (opts: { file: string; cwd: string; filter?: (path: string) => boolean }) => Promise<void>
  Unpack: new (opts: TarUnpackOptions) => TarUnpack
}
let tarModule: TarModule | null = null

async function loadTarModule(): Promise<TarModule> {
  if (tarModule) return tarModule
  try {
    const imported = await import("tar")
    tarModule = imported as unknown as TarModule
    return tarModule
  } catch (error) {
    throw new Error(`Failed to load tar module. Please install optional dependencies: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// unbzip2-stream is an optional dependency for decompressing .tar.bz2 files
type Unbzip2Stream = () => NodeJS.ReadWriteStream
let unbzip2StreamModule: Unbzip2Stream | null = null

async function loadUnbzip2StreamModule(): Promise<Unbzip2Stream> {
  if (unbzip2StreamModule) return unbzip2StreamModule
  try {
    const imported = await import("unbzip2-stream")
    unbzip2StreamModule = (imported.default ?? imported) as Unbzip2Stream
    return unbzip2StreamModule
  } catch (error) {
    throw new Error(`Failed to load unbzip2-stream module. Please install optional dependencies: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Type definitions for sherpa-onnx native addon
// These mirror the native addon exports and the OfflineTts wrapper class
interface SherpaOnnxNativeAddon {
  createOfflineTts: (config: unknown) => unknown
  getOfflineTtsSampleRate: (handle: unknown) => number
  getOfflineTtsNumSpeakers: (handle: unknown) => number
  offlineTtsGenerate: (handle: unknown, request: { text: string; sid?: number; speed?: number; enableExternalBuffer?: boolean }) => { samples: Float32Array; sampleRate: number }
}

interface SherpaOnnxOfflineTts {
  generate(data: { text: string; sid?: number; speed?: number }): { samples: Float32Array; sampleRate: number }
  sampleRate: number
  numSpeakers: number
}

interface SherpaOnnxModule {
  OfflineTts: new (config: unknown) => SherpaOnnxOfflineTts
}
type OfflineTtsType = SherpaOnnxOfflineTts

// Cache for the native addon
let nativeAddon: SherpaOnnxNativeAddon | null = null

const MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_1-fp16.tar.bz2"

const MODEL_DIR_NAME = "kitten-nano-en-v0_1-fp16"

// Expected files after extraction
const REQUIRED_FILES = [
  "model.fp16.onnx",
  "voices.bin",
  "tokens.txt",
]

// Voice definitions (sid 0-7)
// Based on official docs: https://k2-fsa.github.io/sherpa/onnx/tts/all/English/kitten-nano-en-v0_1.html
// Even IDs (0,2,4,6) are male (expr-voice-X-m), odd IDs (1,3,5,7) are female (expr-voice-X-f)
const VOICES = [
  { id: 0, label: "Voice 2 - Male", gender: "male", style: "expr-voice-2" },
  { id: 1, label: "Voice 2 - Female", gender: "female", style: "expr-voice-2" },
  { id: 2, label: "Voice 3 - Male", gender: "male", style: "expr-voice-3" },
  { id: 3, label: "Voice 3 - Female", gender: "female", style: "expr-voice-3" },
  { id: 4, label: "Voice 4 - Male", gender: "male", style: "expr-voice-4" },
  { id: 5, label: "Voice 4 - Female", gender: "female", style: "expr-voice-4" },
  { id: 6, label: "Voice 5 - Male", gender: "male", style: "expr-voice-5" },
  { id: 7, label: "Voice 5 - Female", gender: "female", style: "expr-voice-5" },
] as const

export interface Voice {
  id: number
  label: string
  gender: string
  style: string
}

export interface KittenModelStatus {
  downloaded: boolean
  downloading: boolean
  progress: number
  error?: string
  path?: string
}

export interface SynthesisResult {
  samples: Float32Array
  sampleRate: number
}

// Lazily loaded sherpa-onnx module and TTS instance
let sherpaModule: SherpaOnnxModule | null = null
let ttsInstance: OfflineTtsType | null = null
let sherpaLoadError: string | null = null

/**
 * Get the path to the sherpa-onnx platform-specific package.
 */
function getSherpaLibraryPath(): string | null {
  const platform = os.platform() === "win32" ? "win" : os.platform()
  const arch = os.arch()
  const platformPackage = `sherpa-onnx-${platform}-${arch}`

  const possiblePaths: string[] = []

  // For packaged app, check extraResources directory first (bundled by electron-builder)
  if (app.isPackaged) {
    possiblePaths.push(
      path.join(process.resourcesPath, platformPackage)
    )
    // Legacy: also check node_modules in case it was bundled there
    possiblePaths.push(
      path.join(process.resourcesPath, "app", "node_modules", platformPackage)
    )
  }

  // Try pnpm virtual store in app's node_modules
  const appNodeModules = path.join(__dirname, "..", "..", "node_modules")
  const pnpmBase = path.join(appNodeModules, ".pnpm")
  if (fs.existsSync(pnpmBase)) {
    try {
      const dirs = fs.readdirSync(pnpmBase)
      const platformDir = dirs.find(d => d.startsWith(`${platformPackage}@`))
      if (platformDir) {
        possiblePaths.push(path.join(pnpmBase, platformDir, "node_modules", platformPackage))
      }
    } catch {
      // Ignore read errors
    }
  }

  // Standard node_modules layout
  possiblePaths.push(path.join(appNodeModules, platformPackage))

  // Root monorepo node_modules (development) - check both cwd and parent directories
  // In monorepo, sherpa-onnx is hoisted to root node_modules
  const cwdPnpmBase = path.join(process.cwd(), "node_modules", ".pnpm")
  const monorepoRootPnpmBase = path.join(process.cwd(), "..", "..", "node_modules", ".pnpm")

  for (const rootPnpmBase of [cwdPnpmBase, monorepoRootPnpmBase]) {
    if (fs.existsSync(rootPnpmBase)) {
      try {
        const dirs = fs.readdirSync(rootPnpmBase)
        const platformDir = dirs.find(d => d.startsWith(`${platformPackage}@`))
        if (platformDir) {
          possiblePaths.push(path.join(rootPnpmBase, platformDir, "node_modules", platformPackage))
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  possiblePaths.push(path.join(process.cwd(), "node_modules", platformPackage))
  possiblePaths.push(path.join(process.cwd(), "..", "..", "node_modules", platformPackage))

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`[Kitten] Found sherpa-onnx at: ${p}`)
      return p
    }
  }

  console.warn(`[Kitten] Could not find ${platformPackage} in any of:`, possiblePaths)
  return null
}

/**
 * Configure library path environment variables for native module loading.
 */
function configureSherpaLibraryPath(): void {
  const sherpaPath = getSherpaLibraryPath()
  if (!sherpaPath) {
    console.warn("[Kitten] Could not find sherpa-onnx platform-specific package")
    return
  }

  console.log(`[Kitten] Found sherpa-onnx native libraries at: ${sherpaPath}`)

  if (os.platform() === "darwin") {
    const current = process.env.DYLD_LIBRARY_PATH || ""
    if (!current.includes(sherpaPath)) {
      process.env.DYLD_LIBRARY_PATH = sherpaPath + (current ? `:${current}` : "")
    }
  } else if (os.platform() === "linux") {
    const current = process.env.LD_LIBRARY_PATH || ""
    if (!current.includes(sherpaPath)) {
      process.env.LD_LIBRARY_PATH = sherpaPath + (current ? `:${current}` : "")
    }
  }
}

/**
 * Load the native sherpa-onnx addon directly from the platform-specific package.
 * This bypasses sherpa-onnx-node's addon.js which has path resolution issues in pnpm/Vite.
 */
function loadNativeAddon(): SherpaOnnxNativeAddon | null {
  if (nativeAddon) {
    return nativeAddon
  }

  const sherpaPath = getSherpaLibraryPath()
  if (!sherpaPath) {
    console.error("[Kitten] Could not find sherpa-onnx platform-specific package")
    return null
  }

  const nodePath = path.join(sherpaPath, "sherpa-onnx.node")
  if (!fs.existsSync(nodePath)) {
    console.error(`[Kitten] Native addon not found at: ${nodePath}`)
    return null
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeAddon = require(nodePath) as SherpaOnnxNativeAddon
    console.log(`[Kitten] Native addon loaded from: ${nodePath}`)
    return nativeAddon
  } catch (error) {
    console.error(`[Kitten] Failed to load native addon: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * OfflineTts wrapper class that mirrors sherpa-onnx-node's OfflineTts class.
 * This wraps the native addon functions to provide a clean API.
 */
class OfflineTtsWrapper implements SherpaOnnxOfflineTts {
  private handle: unknown
  public sampleRate: number
  public numSpeakers: number

  constructor(config: unknown, addon: SherpaOnnxNativeAddon) {
    this.handle = addon.createOfflineTts(config)
    this.sampleRate = addon.getOfflineTtsSampleRate(this.handle)
    this.numSpeakers = addon.getOfflineTtsNumSpeakers(this.handle)
  }

  generate(data: { text: string; sid?: number; speed?: number }): { samples: Float32Array; sampleRate: number } {
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Native addon not loaded")
    }
    // Pass enableExternalBuffer: false to avoid "External buffers are not allowed" error in Electron >= 21
    // See: https://k2-fsa.github.io/sherpa/onnx/faqs/index.html
    const result = addon.offlineTtsGenerate(this.handle, {
      ...data,
      enableExternalBuffer: false,
    })
    return {
      samples: result.samples,
      sampleRate: result.sampleRate,
    }
  }
}

/**
 * Lazily load the sherpa-onnx module by loading the native addon directly.
 */
async function loadSherpaModule(): Promise<SherpaOnnxModule | null> {
  if (sherpaModule) {
    return sherpaModule
  }

  if (sherpaLoadError) {
    return null
  }

  try {
    configureSherpaLibraryPath()
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Could not load native addon")
    }

    // Capture the addon in a local const that TypeScript knows is not null
    const capturedAddon: SherpaOnnxNativeAddon = addon

    // Create a module object that provides the OfflineTts constructor
    sherpaModule = {
      OfflineTts: class implements SherpaOnnxOfflineTts {
        private wrapper: OfflineTtsWrapper
        public sampleRate: number
        public numSpeakers: number

        constructor(config: unknown) {
          this.wrapper = new OfflineTtsWrapper(config, capturedAddon)
          this.sampleRate = this.wrapper.sampleRate
          this.numSpeakers = this.wrapper.numSpeakers
        }

        generate(data: { text: string; sid?: number; speed?: number }): { samples: Float32Array; sampleRate: number } {
          return this.wrapper.generate(data)
        }
      }
    }
    console.log("[Kitten] sherpa-onnx module loaded successfully")
    return sherpaModule
  } catch (error) {
    sherpaLoadError = error instanceof Error ? error.message : String(error)
    console.error("[Kitten] Failed to load sherpa-onnx:", sherpaLoadError)
    return null
  }
}

/**
 * Get the base path for model storage
 */
function getModelsPath(): string {
  return path.join(app.getPath("userData"), "models", "kitten")
}

/**
 * Get the full path to a model file
 */
function getModelFilePath(filename: string): string {
  return path.join(getModelsPath(), MODEL_DIR_NAME, filename)
}

/**
 * Check if all required model files exist
 */
function isModelReady(): boolean {
  try {
    for (const file of REQUIRED_FILES) {
      const filePath = getModelFilePath(file)
      if (!fs.existsSync(filePath)) {
        return false
      }
    }
    // Also check espeak-ng-data directory
    const espeakDir = path.join(getModelsPath(), MODEL_DIR_NAME, "espeak-ng-data")
    if (!fs.existsSync(espeakDir)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Get current model status
 */
export function getKittenModelStatus(): KittenModelStatus {
  const downloaded = isModelReady()
  return {
    downloaded,
    downloading: downloadState.downloading,
    progress: downloadState.progress,
    error: downloadState.error,
    path: downloaded ? path.join(getModelsPath(), MODEL_DIR_NAME) : undefined,
  }
}

/**
 * Download a file with progress tracking
 */
function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    // Helper to close file and clean up before rejecting
    const cleanupAndReject = (err: Error) => {
      file.destroy()
      fs.unlink(destPath, () => {})
      reject(err)
    }

    const request = (currentUrl: string) => {
      https
        .get(currentUrl, (response) => {
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            // Drain and destroy the redirect response to avoid leaking sockets
            response.resume()
            // Resolve relative redirect URLs against current URL
            const redirectUrl = new URL(response.headers.location, currentUrl).toString()
            request(redirectUrl)
            return
          }

          if (response.statusCode !== 200) {
            cleanupAndReject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
            return
          }

          const totalSize = parseInt(response.headers["content-length"] || "0", 10)
          let downloadedSize = 0

          response.on("data", (chunk: Buffer) => {
            downloadedSize += chunk.length
            if (totalSize > 0) {
              onProgress?.(downloadedSize / totalSize)
            }
          })

          response.pipe(file)

          file.on("finish", () => {
            file.close()
            resolve()
          })

          file.on("error", (err) => {
            cleanupAndReject(err)
          })
        })
        .on("error", (err) => {
          cleanupAndReject(err)
        })
    }

    request(url)
  })
}



// Module-level state for download tracking
const downloadState = {
  downloading: false,
  progress: 0,
  error: undefined as string | undefined,
}

/**
 * Download the Kitten TTS model from GitHub releases
 */
export async function downloadKittenModel(
  onProgress?: (progress: number) => void
): Promise<void> {
  if (downloadState.downloading) {
    throw new Error("Model download already in progress")
  }

  if (isModelReady()) {
    return
  }

  downloadState.downloading = true
  downloadState.progress = 0
  downloadState.error = undefined

  const modelsPath = getModelsPath()
  fs.mkdirSync(modelsPath, { recursive: true })

  const archivePath = path.join(modelsPath, "model.tar.bz2")

  try {
    // Download the archive
    await downloadFile(MODEL_URL, archivePath, (progress) => {
      downloadState.progress = progress * 0.8 // 80% for download
      onProgress?.(downloadState.progress)
    })

    downloadState.progress = 0.8
    onProgress?.(0.8)

    // Extract the archive - use streaming bz2 decompression since node-tar
    // doesn't natively support bzip2 compression
    const tar = await loadTarModule()
    const unbzip2 = await loadUnbzip2StreamModule()

    // Create a read stream from the downloaded archive
    const readStream = fs.createReadStream(archivePath)
    // Create a bz2 decompression stream
    const decompressStream = unbzip2()
    // Create a tar extraction stream with filter to only extract needed files
    const extractStream = new tar.Unpack({
      cwd: modelsPath,
      filter: (entryPath: string) => {
        // Only extract the files we need, plus directories containing them
        const basename = path.basename(entryPath)
        // Allow directories (needed for tar extraction to work)
        if (entryPath.endsWith("/")) {
          return true
        }
        // Allow required model files
        if (REQUIRED_FILES.includes(basename)) {
          return true
        }
        // Allow espeak-ng-data files (required for phoneme synthesis)
        if (entryPath.includes("espeak-ng-data/")) {
          return true
        }
        return false
      },
    })

    // Pipe: read archive -> decompress bz2 -> extract tar
    await pipeline(readStream, decompressStream, extractStream)

    downloadState.progress = 0.95
    onProgress?.(0.95)

    // Clean up archive
    try {
      fs.unlinkSync(archivePath)
    } catch {
      // Ignore cleanup errors
    }

    // Verify extraction was successful by checking all required files exist
    if (!isModelReady()) {
      throw new Error("Model extraction failed: required files not found after extraction")
    }

    downloadState.progress = 1
    onProgress?.(1)
  } catch (error) {
    downloadState.error = error instanceof Error ? error.message : String(error)
    // Clean up partial download
    try {
      fs.unlinkSync(archivePath)
    } catch {
      // Ignore
    }
    throw error
  } finally {
    downloadState.downloading = false
  }
}

/**
 * Initialize the TTS instance with the downloaded model
 */
async function initializeTts(): Promise<OfflineTtsType> {
  if (ttsInstance) {
    return ttsInstance
  }

  if (!isModelReady()) {
    throw new Error("Model not downloaded. Call downloadKittenModel() first.")
  }

  const sherpa = await loadSherpaModule()
  if (!sherpa) {
    throw new Error(`Failed to load sherpa-onnx-node: ${sherpaLoadError || "Unknown error"}`)
  }

  const modelPath = path.join(getModelsPath(), MODEL_DIR_NAME)

  const config = {
    model: {
      kitten: {
        model: path.join(modelPath, "model.fp16.onnx"),
        voices: path.join(modelPath, "voices.bin"),
        tokens: path.join(modelPath, "tokens.txt"),
        dataDir: path.join(modelPath, "espeak-ng-data"),
      },
      numThreads: 1,
      provider: "cpu",
    },
    maxNumSentences: 1,
  }

  ttsInstance = new sherpa.OfflineTts(config)
  console.log("[Kitten] TTS initialized successfully")
  return ttsInstance
}

/**
 * Synthesize speech from text
 * @param text - The text to synthesize
 * @param voiceId - Voice ID (0-7), defaults to 0
 * @param speed - Speech speed (default: 1.0)
 * @returns Audio samples and sample rate
 */
export async function synthesize(
  text: string,
  voiceId = 0,
  speed = 1.0
): Promise<SynthesisResult> {
  const tts = await initializeTts()

  // The generate() method already copies the samples to JS-owned memory
  // to avoid "External buffers are not allowed" error with Electron IPC
  return tts.generate({
    text,
    sid: voiceId,
    speed,
  })
}

/**
 * Get available voices for synthesis
 */
export function getAvailableVoices(): Voice[] {
  return VOICES.map(v => ({ ...v }))
}

/**
 * Dispose of the TTS instance to free resources
 */
export function disposeTts(): void {
  ttsInstance = null
}