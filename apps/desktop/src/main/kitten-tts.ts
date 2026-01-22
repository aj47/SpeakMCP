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
import * as tar from "tar"

// Type imports only - actual module loaded dynamically
type SherpaOnnxModule = typeof import("sherpa-onnx-node")
type OfflineTtsType = import("sherpa-onnx-node").OfflineTts

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
const VOICES = [
  { id: 0, label: "Female Energetic", gender: "female", style: "energetic" },
  { id: 1, label: "Female Calm", gender: "female", style: "calm" },
  { id: 2, label: "Female Cheerful", gender: "female", style: "cheerful" },
  { id: 3, label: "Female Serious", gender: "female", style: "serious" },
  { id: 4, label: "Male Energetic", gender: "male", style: "energetic" },
  { id: 5, label: "Male Calm", gender: "male", style: "calm" },
  { id: 6, label: "Male Cheerful", gender: "male", style: "cheerful" },
  { id: 7, label: "Male Serious", gender: "male", style: "serious" },
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

  // For packaged app, check resources directory
  if (app.isPackaged) {
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
 * Lazily load the sherpa-onnx-node module.
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
    const imported = await import("sherpa-onnx-node")
    sherpaModule = (imported.default ?? imported) as SherpaOnnxModule
    console.log("[Kitten] sherpa-onnx-node loaded successfully")
    return sherpaModule
  } catch (error) {
    sherpaLoadError = error instanceof Error ? error.message : String(error)
    console.error("[Kitten] Failed to load sherpa-onnx-node:", sherpaLoadError)
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

    // Extract the archive
    await tar.x({
      file: archivePath,
      cwd: modelsPath,
    })

    downloadState.progress = 0.95
    onProgress?.(0.95)

    // Clean up archive
    try {
      fs.unlinkSync(archivePath)
    } catch {
      // Ignore cleanup errors
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

  const audio = tts.generate({
    text,
    sid: voiceId,
    speed,
  })

  return {
    samples: audio.samples,
    sampleRate: audio.sampleRate,
  }
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