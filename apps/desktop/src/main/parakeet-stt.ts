/**
 * Parakeet STT Service
 *
 * Provides local speech-to-text transcription using the Parakeet model
 * via sherpa-onnx. Handles model download, extraction, and transcription.
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
// These mirror the native addon exports for direct loading
interface SherpaOnnxNativeAddon {
  createOfflineRecognizer: (config: unknown) => unknown
  createOfflineStream: (recognizerHandle: unknown) => unknown
  acceptWaveformOffline: (streamHandle: unknown, data: { samples: Float32Array; sampleRate: number }) => void
  decodeOfflineStream: (recognizerHandle: unknown, streamHandle: unknown) => void
  getOfflineStreamResultAsJson: (streamHandle: unknown) => string
}

// High-level interfaces for the wrapper classes
interface SherpaOnnxOfflineRecognizer {
  createStream(): SherpaOnnxOfflineStream
  decode(stream: SherpaOnnxOfflineStream): void
  getResult(stream: SherpaOnnxOfflineStream): { text: string }
}
interface SherpaOnnxOfflineStream {
  handle: unknown
  acceptWaveform(data: { samples: Float32Array; sampleRate: number }): void
}
interface SherpaOnnxModule {
  OfflineRecognizer: new (config: unknown) => SherpaOnnxOfflineRecognizer
}
type OfflineRecognizerType = SherpaOnnxOfflineRecognizer

// Cache for the native addon
let nativeAddon: SherpaOnnxNativeAddon | null = null

const MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"

const MODEL_DIR_NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"

// Expected files after extraction
const REQUIRED_FILES = [
  "encoder.int8.onnx",
  "decoder.int8.onnx",
  "joiner.int8.onnx",
  "tokens.txt",
]

export interface ModelStatus {
  downloaded: boolean
  downloading: boolean
  progress: number
  error?: string
}

let modelStatus: ModelStatus = {
  downloaded: false,
  downloading: false,
  progress: 0,
}

// Lazily loaded sherpa-onnx module and recognizer
let sherpaModule: SherpaOnnxModule | null = null
let recognizer: OfflineRecognizerType | null = null
let recognizerNumThreads: number | null = null // Track current config for reuse
let sherpaLoadError: string | null = null

/**
 * Get the path to the sherpa-onnx platform-specific package.
 * Handles both regular node_modules and pnpm virtual store layouts,
 * as well as packaged Electron apps.
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
      console.log(`[Parakeet] Found sherpa-onnx at: ${p}`)
      return p
    }
  }

  console.warn(`[Parakeet] Could not find ${platformPackage} in any of:`, possiblePaths)
  return null
}

/**
 * Configure library path environment variables for native module loading.
 * This must be called before the first import of sherpa-onnx-node.
 */
function configureSherpaLibraryPath(): void {
  const sherpaPath = getSherpaLibraryPath()
  if (!sherpaPath) {
    console.warn("[Parakeet] Could not find sherpa-onnx platform-specific package")
    return
  }

  console.log(`[Parakeet] Found sherpa-onnx native libraries at: ${sherpaPath}`)

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
  // Windows uses PATH, but native modules usually handle this automatically
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
    console.error("[Parakeet] Could not find sherpa-onnx platform-specific package")
    return null
  }

  const nodePath = path.join(sherpaPath, "sherpa-onnx.node")
  if (!fs.existsSync(nodePath)) {
    console.error(`[Parakeet] Native addon not found at: ${nodePath}`)
    return null
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeAddon = require(nodePath) as SherpaOnnxNativeAddon
    console.log(`[Parakeet] Native addon loaded from: ${nodePath}`)
    return nativeAddon
  } catch (error) {
    console.error(`[Parakeet] Failed to load native addon: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * OfflineStream wrapper class that mirrors sherpa-onnx-node's OfflineStream class.
 */
class OfflineStreamWrapper implements SherpaOnnxOfflineStream {
  public handle: unknown

  constructor(handle: unknown) {
    this.handle = handle
  }

  acceptWaveform(data: { samples: Float32Array; sampleRate: number }): void {
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Native addon not loaded")
    }
    addon.acceptWaveformOffline(this.handle, data)
  }
}

/**
 * OfflineRecognizer wrapper class that mirrors sherpa-onnx-node's OfflineRecognizer class.
 */
class OfflineRecognizerWrapper implements SherpaOnnxOfflineRecognizer {
  private recognizerHandle: unknown

  constructor(config: unknown, addon: SherpaOnnxNativeAddon) {
    this.recognizerHandle = addon.createOfflineRecognizer(config)
  }

  createStream(): SherpaOnnxOfflineStream {
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Native addon not loaded")
    }
    const streamHandle = addon.createOfflineStream(this.recognizerHandle)
    return new OfflineStreamWrapper(streamHandle)
  }

  decode(stream: SherpaOnnxOfflineStream): void {
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Native addon not loaded")
    }
    addon.decodeOfflineStream(this.recognizerHandle, stream.handle)
  }

  getResult(stream: SherpaOnnxOfflineStream): { text: string } {
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Native addon not loaded")
    }
    const jsonStr = addon.getOfflineStreamResultAsJson(stream.handle)
    return JSON.parse(jsonStr)
  }
}

/**
 * Lazily load the sherpa-onnx module by loading the native addon directly.
 * This bypasses sherpa-onnx-node's addon.js which has path resolution issues in pnpm/Vite.
 */
async function loadSherpaModule(): Promise<SherpaOnnxModule | null> {
  if (sherpaModule) {
    return sherpaModule
  }

  if (sherpaLoadError) {
    // Don't retry if we've already failed
    return null
  }

  try {
    // Configure library paths before loading native addon
    configureSherpaLibraryPath()

    // Load native addon directly
    const addon = loadNativeAddon()
    if (!addon) {
      throw new Error("Failed to load sherpa-onnx native addon")
    }

    // Capture the addon in a local const that TypeScript knows is not null
    const capturedAddon: SherpaOnnxNativeAddon = addon

    // Create a module object that provides the OfflineRecognizer constructor
    sherpaModule = {
      OfflineRecognizer: class implements SherpaOnnxOfflineRecognizer {
        private wrapper: OfflineRecognizerWrapper

        constructor(config: unknown) {
          this.wrapper = new OfflineRecognizerWrapper(config, capturedAddon)
        }

        createStream(): SherpaOnnxOfflineStream {
          return this.wrapper.createStream()
        }

        decode(stream: SherpaOnnxOfflineStream): void {
          this.wrapper.decode(stream)
        }

        getResult(stream: SherpaOnnxOfflineStream): { text: string } {
          return this.wrapper.getResult(stream)
        }
      }
    }

    console.log("[Parakeet] sherpa-onnx module loaded successfully")
    return sherpaModule
  } catch (error) {
    sherpaLoadError = error instanceof Error ? error.message : String(error)
    console.error("[Parakeet] Failed to load sherpa-onnx-node:", sherpaLoadError)
    return null
  }
}

/**
 * Check if the sherpa-onnx native module is available.
 */
export async function isSherpaAvailable(): Promise<boolean> {
  const module = await loadSherpaModule()
  return module !== null
}

/**
 * Get the error message if sherpa-onnx failed to load.
 */
export function getSherpaLoadError(): string | null {
  return sherpaLoadError
}

/**
 * Get the base path for model storage
 */
function getModelsPath(): string {
  return path.join(app.getPath("userData"), "models", "parakeet")
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
export function isModelReady(): boolean {
  try {
    for (const file of REQUIRED_FILES) {
      const filePath = getModelFilePath(file)
      if (!fs.existsSync(filePath)) {
        return false
      }
    }
    modelStatus.downloaded = true
    return true
  } catch {
    return false
  }
}

/**
 * Get current model download status
 */
export function getModelStatus(): ModelStatus {
  // Refresh downloaded status
  if (!modelStatus.downloading) {
    modelStatus.downloaded = isModelReady()
  }
  return { ...modelStatus }
}

/**
 * Download the model from GitHub releases
 */
export async function downloadModel(
  onProgress?: (progress: number) => void
): Promise<void> {
  if (modelStatus.downloading) {
    throw new Error("Model download already in progress")
  }

  if (isModelReady()) {
    return
  }

  modelStatus.downloading = true
  modelStatus.progress = 0
  modelStatus.error = undefined

  const modelsPath = getModelsPath()
  fs.mkdirSync(modelsPath, { recursive: true })

  const archivePath = path.join(modelsPath, "model.tar.bz2")

  try {
    // Download the archive
    await downloadFile(MODEL_URL, archivePath, (progress) => {
      modelStatus.progress = progress * 0.8 // 80% for download
      onProgress?.(modelStatus.progress)
    })

    // Extract the archive - use streaming bz2 decompression since node-tar
    // doesn't natively support bzip2 compression
    modelStatus.progress = 0.8
    onProgress?.(0.8)

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
        return REQUIRED_FILES.includes(basename)
      },
    })

    // Pipe: read archive -> decompress bz2 -> extract tar
    await pipeline(readStream, decompressStream, extractStream)

    modelStatus.progress = 0.95
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

    modelStatus.downloaded = true
    modelStatus.progress = 1
    modelStatus.downloading = false
    onProgress?.(1)
  } catch (error) {
    modelStatus.downloading = false
    modelStatus.error = error instanceof Error ? error.message : String(error)
    // Clean up partial download
    try {
      fs.unlinkSync(archivePath)
    } catch {
      // Ignore
    }
    throw error
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
          // Handle redirects
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

/**
 * Initialize the recognizer with the downloaded model.
 * Reuses existing recognizer if already initialized with the same numThreads.
 */
export async function initializeRecognizer(numThreads = 2): Promise<void> {
  if (!isModelReady()) {
    throw new Error("Model not downloaded. Call downloadModel() first.")
  }

  // Reuse existing recognizer if already initialized with the same config
  if (recognizer && recognizerNumThreads === numThreads) {
    return
  }

  if (recognizer) {
    // Dispose of existing recognizer to allow reconfiguration (e.g., numThreads change)
    disposeRecognizer()
  }

  // Load the sherpa-onnx module dynamically
  const sherpa = await loadSherpaModule()
  if (!sherpa) {
    throw new Error(`Failed to load sherpa-onnx-node: ${sherpaLoadError || "Unknown error"}`)
  }

  const modelPath = path.join(getModelsPath(), MODEL_DIR_NAME)

  const config = {
    modelConfig: {
      transducer: {
        encoder: path.join(modelPath, "encoder.int8.onnx"),
        decoder: path.join(modelPath, "decoder.int8.onnx"),
        joiner: path.join(modelPath, "joiner.int8.onnx"),
      },
      tokens: path.join(modelPath, "tokens.txt"),
      numThreads,
      provider: "cpu",
      debug: 0,
    },
  }

  recognizer = new sherpa.OfflineRecognizer(config)
  recognizerNumThreads = numThreads
}

/**
 * Transcribe audio data
 * @param audioBuffer - ArrayBuffer containing audio samples
 * @param sampleRate - Sample rate of the audio (default: 16000)
 * @returns Transcribed text
 */
export async function transcribe(
  audioBuffer: ArrayBuffer,
  sampleRate = 16000
): Promise<string> {
  // Capture recognizer into a local const to avoid race conditions if
  // initializeRecognizer() runs concurrently and swaps the global
  const currentRecognizer = recognizer
  if (!currentRecognizer) {
    throw new Error("Recognizer not initialized. Call initializeRecognizer() first.")
  }

  // Validate that the buffer contains properly-aligned float32 PCM data.
  // Each float32 sample is 4 bytes; if the byte length isn't divisible by 4 the
  // buffer is not valid PCM (e.g. raw webm/compressed audio was passed instead).
  if (audioBuffer.byteLength % 4 !== 0) {
    throw new Error(
      `Invalid PCM audio buffer: byte length ${audioBuffer.byteLength} is not a multiple of 4. ` +
      `Audio must be decoded to float32 PCM before transcription with Parakeet.`
    )
  }

  // Convert ArrayBuffer to Float32Array
  const samples = new Float32Array(audioBuffer)

  // Create a stream for this transcription
  const stream = currentRecognizer.createStream()

  // Accept the waveform
  stream.acceptWaveform({ samples, sampleRate })

  // Decode
  currentRecognizer.decode(stream)

  // Get result
  const result = currentRecognizer.getResult(stream)

  return result.text || ""
}

/**
 * Dispose of the recognizer to free resources
 */
export function disposeRecognizer(): void {
  recognizer = null
  recognizerNumThreads = null
}

