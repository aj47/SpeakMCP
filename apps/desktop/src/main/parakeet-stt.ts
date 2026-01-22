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
import * as tar from "tar"

// Type definitions for sherpa-onnx-node (optional dependency, loaded dynamically)
// These mirror the actual types but allow compilation without the package installed
interface SherpaOnnxOfflineRecognizer {
  createStream(): SherpaOnnxOfflineStream
  decode(stream: SherpaOnnxOfflineStream): void
  getResult(stream: SherpaOnnxOfflineStream): { text: string }
}
interface SherpaOnnxOfflineStream {
  acceptWaveform(data: { samples: Float32Array; sampleRate: number }): void
}
interface SherpaOnnxModule {
  OfflineRecognizer: new (config: unknown) => SherpaOnnxOfflineRecognizer
}
type OfflineRecognizerType = SherpaOnnxOfflineRecognizer

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

  // For packaged app, check resources directory
  if (app.isPackaged) {
    // In packaged app, node_modules is in resources/app/node_modules
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

  // Root monorepo node_modules (development)
  const rootPnpmBase = path.join(process.cwd(), "node_modules", ".pnpm")
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

  possiblePaths.push(path.join(process.cwd(), "node_modules", platformPackage))

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
 * Lazily load the sherpa-onnx-node module.
 * Configures library paths and handles errors gracefully.
 *
 * Note: sherpa-onnx-node is a CommonJS module, so when using dynamic import
 * the exports are on the `default` property, not as named exports.
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
    // Configure library paths before first import
    configureSherpaLibraryPath()

    // Dynamic import - handle CommonJS interop
    // @ts-expect-error - sherpa-onnx-node is an optional dependency that may not be installed
    const imported = await import("sherpa-onnx-node")
    // For CommonJS modules imported in ESM, exports are on .default
    sherpaModule = (imported.default ?? imported) as SherpaOnnxModule
    console.log("[Parakeet] sherpa-onnx-node loaded successfully")
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

    // Extract the archive
    modelStatus.progress = 0.8
    onProgress?.(0.8)

    await tar.x({
      file: archivePath,
      cwd: modelsPath,
      filter: (entryPath) => {
        // Only extract the files we need, plus directories containing them
        const basename = path.basename(entryPath)
        // Allow directories (needed for tar extraction to work)
        if (entryPath.endsWith("/")) {
          return true
        }
        return REQUIRED_FILES.includes(basename)
      },
    })

    modelStatus.progress = 0.95
    onProgress?.(0.95)

    // Clean up archive
    try {
      fs.unlinkSync(archivePath)
    } catch {
      // Ignore cleanup errors
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
 * Initialize the recognizer with the downloaded model
 */
export async function initializeRecognizer(numThreads = 2): Promise<void> {
  if (!isModelReady()) {
    throw new Error("Model not downloaded. Call downloadModel() first.")
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
  if (!recognizer) {
    throw new Error("Recognizer not initialized. Call initializeRecognizer() first.")
  }

  // Convert ArrayBuffer to Float32Array
  const samples = new Float32Array(audioBuffer)

  // Create a stream for this transcription
  const stream = recognizer.createStream()

  // Accept the waveform
  stream.acceptWaveform({ samples, sampleRate })

  // Decode
  recognizer.decode(stream)

  // Get result
  const result = recognizer.getResult(stream)

  return result.text || ""
}

/**
 * Dispose of the recognizer to free resources
 */
export function disposeRecognizer(): void {
  recognizer = null
}

