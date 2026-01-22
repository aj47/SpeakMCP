/**
 * Parakeet STT Service
 *
 * Provides local speech-to-text transcription using the Parakeet model
 * via sherpa-onnx. Handles model download, extraction, and transcription.
 */

import { app } from "electron"
import * as fs from "fs"
import * as path from "path"
import * as https from "https"
import { OfflineRecognizer } from "sherpa-onnx-node"
import * as tar from "tar"

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

let recognizer: OfflineRecognizer | null = null

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
        // Only extract the files we need
        const basename = path.basename(entryPath)
        return REQUIRED_FILES.includes(basename) || entryPath.includes("/")
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
            request(response.headers.location)
            return
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
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
            fs.unlink(destPath, () => {})
            reject(err)
          })
        })
        .on("error", (err) => {
          fs.unlink(destPath, () => {})
          reject(err)
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
    return // Already initialized
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

  recognizer = new OfflineRecognizer(config)
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

