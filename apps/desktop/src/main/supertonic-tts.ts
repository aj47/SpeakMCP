/**
 * Supertonic TTS Service
 *
 * Provides local text-to-speech synthesis using the Supertonic model
 * via onnxruntime-node. Handles model download, voice style management,
 * and synthesis.
 *
 * Based on the supertonic Node.js SDK:
 * https://github.com/supertone-inc/supertonic
 *
 * Model: https://huggingface.co/Supertone/supertonic-2
 * License: OpenRAIL-M (model), MIT (code)
 */

import { app } from "electron"
import * as fs from "fs"
import * as path from "path"
import * as https from "https"

// onnxruntime-node types (dynamically imported)
type OrtModule = typeof import("onnxruntime-node")
type InferenceSession = import("onnxruntime-node").InferenceSession
type Tensor = import("onnxruntime-node").Tensor

const HF_BASE_URL = "https://huggingface.co/Supertone/supertonic-2/resolve/main"

const ONNX_FILES = [
  "onnx/duration_predictor.onnx",
  "onnx/text_encoder.onnx",
  "onnx/vector_estimator.onnx",
  "onnx/vocoder.onnx",
  "onnx/tts.json",
  "onnx/unicode_indexer.json",
]

const VOICE_STYLE_FILES = [
  "voice_styles/M1.json",
  "voice_styles/M2.json",
  "voice_styles/M3.json",
  "voice_styles/M4.json",
  "voice_styles/M5.json",
  "voice_styles/F1.json",
  "voice_styles/F2.json",
  "voice_styles/F3.json",
  "voice_styles/F4.json",
  "voice_styles/F5.json",
]

const ALL_FILES = [...ONNX_FILES, ...VOICE_STYLE_FILES]

const AVAILABLE_LANGS = ["en", "ko", "es", "pt", "fr"]

export interface SupertonicModelStatus {
  downloaded: boolean
  downloading: boolean
  progress: number
  error?: string
  path?: string
}

export interface SupertonicSynthesisResult {
  samples: Float32Array
  sampleRate: number
}

// Module-level state
let ortModule: OrtModule | null = null
let ttsEngine: TextToSpeech | null = null
let ortLoadError: string | null = null

const downloadState = {
  downloading: false,
  progress: 0,
  error: undefined as string | undefined,
}

// --- Path helpers ---

function getModelsPath(): string {
  return path.join(app.getPath("userData"), "models", "supertonic")
}

function getOnnxDir(): string {
  return path.join(getModelsPath(), "onnx")
}

function getVoiceStylesDir(): string {
  return path.join(getModelsPath(), "voice_styles")
}

function getFilePath(relativePath: string): string {
  return path.join(getModelsPath(), relativePath)
}

// --- Model status ---

function isModelReady(): boolean {
  try {
    for (const file of ALL_FILES) {
      if (!fs.existsSync(getFilePath(file))) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

export function getSupertonicModelStatus(): SupertonicModelStatus {
  const downloaded = isModelReady()
  return {
    downloaded,
    downloading: downloadState.downloading,
    progress: downloadState.progress,
    error: downloadState.error,
    path: downloaded ? getModelsPath() : undefined,
  }
}

// --- Download helpers ---

function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    fs.mkdirSync(dir, { recursive: true })

    const file = fs.createWriteStream(destPath)

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
            response.resume()
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
            onProgress?.(downloadedSize, totalSize)
          })

          response.pipe(file)

          file.on("finish", () => {
            file.close()
            resolve()
          })

          file.on("error", cleanupAndReject)
        })
        .on("error", cleanupAndReject)
    }

    request(url)
  })
}

export async function downloadSupertonicModel(
  onProgress?: (progress: number) => void,
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

  try {
    // Calculate which files need downloading
    const filesToDownload = ALL_FILES.filter(
      (f) => !fs.existsSync(getFilePath(f)),
    )

    if (filesToDownload.length === 0) {
      downloadState.progress = 1
      onProgress?.(1)
      return
    }

    let filesCompleted = 0

    for (const file of filesToDownload) {
      const url = `${HF_BASE_URL}/${file}`
      const destPath = getFilePath(file)

      await downloadFile(url, destPath, (_bytesDownloaded, _totalBytes) => {
        // Approximate progress within the current file (rough since we don't know total sizes ahead of time)
      })

      filesCompleted++
      downloadState.progress = filesCompleted / filesToDownload.length
      onProgress?.(downloadState.progress)
    }

    if (!isModelReady()) {
      throw new Error("Model download failed: some files missing after download")
    }

    downloadState.progress = 1
    onProgress?.(1)
  } catch (error) {
    downloadState.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    downloadState.downloading = false
  }
}

// --- ONNX Runtime loading ---

async function loadOrt(): Promise<OrtModule> {
  if (ortModule) return ortModule
  if (ortLoadError) throw new Error(ortLoadError)

  try {
    ortModule = await import("onnxruntime-node")
    console.log("[Supertonic] onnxruntime-node loaded successfully")
    return ortModule
  } catch (error) {
    ortLoadError = error instanceof Error ? error.message : String(error)
    console.error("[Supertonic] Failed to load onnxruntime-node:", ortLoadError)
    throw new Error(`Failed to load onnxruntime-node: ${ortLoadError}`)
  }
}

// --- Inference helpers (ported from supertonic helper.js) ---

function lengthToMask(lengths: number[], maxLen?: number): number[][][] {
  const max = maxLen ?? Math.max(...lengths)
  const mask: number[][][] = []
  for (let i = 0; i < lengths.length; i++) {
    const row: number[] = []
    for (let j = 0; j < max; j++) {
      row.push(j < lengths[i] ? 1.0 : 0.0)
    }
    mask.push([row]) // [B, 1, maxLen]
  }
  return mask
}

function getLatentMask(
  wavLengths: number[],
  baseChunkSize: number,
  chunkCompressFactor: number,
): number[][][] {
  const latentSize = baseChunkSize * chunkCompressFactor
  const latentLengths = wavLengths.map((len) =>
    Math.floor((len + latentSize - 1) / latentSize),
  )
  return lengthToMask(latentLengths)
}

function chunkText(text: string, maxLen = 300): string[] {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n+/)
    .filter((p) => p.trim())

  const chunks: string[] = []

  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim()
    if (!paragraph) continue

    const sentences = paragraph.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    )

    let currentChunk = ""

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length + 1 <= maxLen) {
        currentChunk += (currentChunk ? " " : "") + sentence
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
        }
        currentChunk = sentence
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim())
    }
  }

  return chunks.length > 0 ? chunks : [text]
}

// --- Unicode Processor ---

class UnicodeProcessor {
  private indexer: Record<number, number>

  constructor(unicodeIndexerJsonPath: string) {
    this.indexer = JSON.parse(fs.readFileSync(unicodeIndexerJsonPath, "utf8"))
  }

  private preprocessText(text: string, lang: string): string {
    let processed = text.normalize("NFKD")

    // Remove emojis
    const emojiPattern =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu
    processed = processed.replace(emojiPattern, "")

    // Replace dashes and symbols
    const replacements: Record<string, string> = {
      "\u2013": "-", // en dash
      "\u2011": "-", // non-breaking hyphen
      "\u2014": "-", // em dash
      _: " ",
      "\u201C": '"',
      "\u201D": '"',
      "\u2018": "'",
      "\u2019": "'",
      "\u00B4": "'",
      "`": "'",
      "[": " ",
      "]": " ",
      "|": " ",
      "/": " ",
      "#": " ",
      "\u2192": " ",
      "\u2190": " ",
    }
    for (const [k, v] of Object.entries(replacements)) {
      processed = processed.replaceAll(k, v)
    }

    // Remove special symbols
    processed = processed.replace(/[♥☆♡©\\]/g, "")

    // Replace known expressions
    const exprReplacements: Record<string, string> = {
      "@": " at ",
      "e.g.,": "for example, ",
      "i.e.,": "that is, ",
    }
    for (const [k, v] of Object.entries(exprReplacements)) {
      processed = processed.replaceAll(k, v)
    }

    // Fix spacing around punctuation
    processed = processed.replace(/ ,/g, ",")
    processed = processed.replace(/ \./g, ".")
    processed = processed.replace(/ !/g, "!")
    processed = processed.replace(/ \?/g, "?")
    processed = processed.replace(/ ;/g, ";")
    processed = processed.replace(/ :/g, ":")
    processed = processed.replace(/ '/g, "'")

    // Remove duplicate quotes
    while (processed.includes('""')) processed = processed.replace('""', '"')
    while (processed.includes("''")) processed = processed.replace("''", "'")
    while (processed.includes("``")) processed = processed.replace("``", "`")

    // Remove extra spaces
    processed = processed.replace(/\s+/g, " ").trim()

    // Add period if no ending punctuation
    if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(processed)) {
      processed += "."
    }

    if (!AVAILABLE_LANGS.includes(lang)) {
      throw new Error(
        `Invalid language: ${lang}. Available: ${AVAILABLE_LANGS.join(", ")}`,
      )
    }

    // Wrap with language tags
    processed = `<${lang}>` + processed + `</${lang}>`
    return processed
  }

  call(
    textList: string[],
    langList: string[],
  ): { textIds: number[][]; textMask: number[][][] } {
    const processedTexts = textList.map((t, i) =>
      this.preprocessText(t, langList[i]),
    )
    // Use Array.from() for lengths to handle surrogate pairs consistently
    const unicodeArrays = processedTexts.map((t) =>
      Array.from(t).map((char) => char.charCodeAt(0)),
    )
    const textIdsLengths = unicodeArrays.map((a) => a.length)
    const maxLen = Math.max(...textIdsLengths)

    const textIds: number[][] = []
    for (let i = 0; i < unicodeArrays.length; i++) {
      const row = new Array(maxLen).fill(0)
      for (let j = 0; j < unicodeArrays[i].length; j++) {
        row[j] = this.indexer[unicodeArrays[i][j]] ?? 0
      }
      textIds.push(row)
    }

    const textMask = lengthToMask(textIdsLengths)
    return { textIds, textMask }
  }
}

// --- Style container ---

interface StyleData {
  ttl: Tensor
  dp: Tensor
}

// --- TTS Engine ---

interface TtsConfig {
  ae: { sample_rate: number; base_chunk_size: number }
  ttl: { chunk_compress_factor: number; latent_dim: number }
}

class TextToSpeech {
  private cfgs: TtsConfig
  private textProcessor: UnicodeProcessor
  private dpOrt: InferenceSession
  private textEncOrt: InferenceSession
  private vectorEstOrt: InferenceSession
  private vocoderOrt: InferenceSession
  private ort: OrtModule
  public sampleRate: number
  private baseChunkSize: number
  private chunkCompressFactor: number
  private ldim: number

  constructor(
    ort: OrtModule,
    cfgs: TtsConfig,
    textProcessor: UnicodeProcessor,
    dpOrt: InferenceSession,
    textEncOrt: InferenceSession,
    vectorEstOrt: InferenceSession,
    vocoderOrt: InferenceSession,
  ) {
    this.ort = ort
    this.cfgs = cfgs
    this.textProcessor = textProcessor
    this.dpOrt = dpOrt
    this.textEncOrt = textEncOrt
    this.vectorEstOrt = vectorEstOrt
    this.vocoderOrt = vocoderOrt
    this.sampleRate = cfgs.ae.sample_rate
    this.baseChunkSize = cfgs.ae.base_chunk_size
    this.chunkCompressFactor = cfgs.ttl.chunk_compress_factor
    this.ldim = cfgs.ttl.latent_dim
  }

  private arrayToTensor(array: number[] | number[][] | number[][][], dims: number[]): Tensor {
    const flat = array.flat(Infinity as 1) as number[]
    return new this.ort.Tensor("float32", Float32Array.from(flat), dims)
  }

  private intArrayToTensor(array: number[][] , dims: number[]): Tensor {
    const flat = (array.flat(Infinity as 1) as number[])
    return new this.ort.Tensor(
      "int64",
      BigInt64Array.from(flat.map((x) => BigInt(x))),
      dims,
    )
  }

  private sampleNoisyLatent(duration: number[]): {
    noisyLatent: number[][][]
    latentMask: number[][][]
  } {
    const wavLenMax = Math.max(...duration) * this.sampleRate
    const wavLengths = duration.map((d) => Math.floor(d * this.sampleRate))
    const chunkSize = this.baseChunkSize * this.chunkCompressFactor
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize)
    const latentDim = this.ldim * this.chunkCompressFactor

    const noisyLatent: number[][][] = []
    for (let b = 0; b < duration.length; b++) {
      const batch: number[][] = []
      for (let d = 0; d < latentDim; d++) {
        const row: number[] = []
        for (let t = 0; t < latentLen; t++) {
          const eps = 1e-10
          const u1 = Math.max(eps, Math.random())
          const u2 = Math.random()
          const randNormal =
            Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
          row.push(randNormal)
        }
        batch.push(row)
      }
      noisyLatent.push(batch)
    }

    const latentMask = getLatentMask(
      wavLengths,
      this.baseChunkSize,
      this.chunkCompressFactor,
    )

    // Apply mask
    for (let b = 0; b < noisyLatent.length; b++) {
      for (let d = 0; d < noisyLatent[b].length; d++) {
        for (let t = 0; t < noisyLatent[b][d].length; t++) {
          noisyLatent[b][d][t] *= latentMask[b][0][t]
        }
      }
    }

    return { noisyLatent, latentMask }
  }

  private async infer(
    textList: string[],
    langList: string[],
    style: StyleData,
    totalStep: number,
    speed: number,
  ): Promise<{ wav: number[]; duration: number[] }> {
    const bsz = textList.length
    const { textIds, textMask } = this.textProcessor.call(textList, langList)
    const textIdsShape = [bsz, textIds[0].length]
    const textMaskShape = [bsz, 1, textMask[0][0].length]

    const textMaskTensor = this.arrayToTensor(textMask, textMaskShape)

    const dpResult = await this.dpOrt.run({
      text_ids: this.intArrayToTensor(textIds, textIdsShape),
      style_dp: style.dp,
      text_mask: textMaskTensor,
    })

    const durOnnx = Array.from(dpResult.duration.data as Float32Array)

    // Apply speed factor
    for (let i = 0; i < durOnnx.length; i++) {
      durOnnx[i] /= speed
    }

    const textEncResult = await this.textEncOrt.run({
      text_ids: this.intArrayToTensor(textIds, textIdsShape),
      style_ttl: style.ttl,
      text_mask: textMaskTensor,
    })

    const textEmbTensor = textEncResult.text_emb

    const { noisyLatent, latentMask } = this.sampleNoisyLatent(durOnnx)
    const latentShape = [
      bsz,
      noisyLatent[0].length,
      noisyLatent[0][0].length,
    ]
    const latentMaskShape = [bsz, 1, latentMask[0][0].length]
    const latentMaskTensor = this.arrayToTensor(latentMask, latentMaskShape)

    const totalStepArray = new Array(bsz).fill(totalStep)
    const scalarShape = [bsz]
    const totalStepTensor = this.arrayToTensor(totalStepArray, scalarShape)

    for (let step = 0; step < totalStep; step++) {
      const currentStepArray = new Array(bsz).fill(step)

      const vectorEstResult = await this.vectorEstOrt.run({
        noisy_latent: this.arrayToTensor(noisyLatent, latentShape),
        text_emb: textEmbTensor,
        style_ttl: style.ttl,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: this.arrayToTensor(currentStepArray, scalarShape),
      })

      const denoisedLatent = Array.from(
        vectorEstResult.denoised_latent.data as Float32Array,
      )

      // Update latent
      let idx = 0
      for (let b = 0; b < noisyLatent.length; b++) {
        for (let d = 0; d < noisyLatent[b].length; d++) {
          for (let t = 0; t < noisyLatent[b][d].length; t++) {
            noisyLatent[b][d][t] = denoisedLatent[idx++]
          }
        }
      }
    }

    const vocoderResult = await this.vocoderOrt.run({
      latent: this.arrayToTensor(noisyLatent, latentShape),
    })

    const wav = Array.from(vocoderResult.wav_tts.data as Float32Array)
    return { wav, duration: durOnnx }
  }

  async synthesizeSingle(
    text: string,
    lang: string,
    style: StyleData,
    totalStep: number,
    speed: number,
    silenceDuration = 0.3,
  ): Promise<{ wav: number[]; duration: number }> {
    const maxLen = lang === "ko" ? 120 : 300
    const textList = chunkText(text, maxLen)
    let wavCat: number[] | null = null
    let durCat = 0

    for (const chunk of textList) {
      const { wav, duration } = await this.infer(
        [chunk],
        [lang],
        style,
        totalStep,
        speed,
      )

      if (wavCat === null) {
        wavCat = wav
        durCat = duration[0]
      } else {
        const silenceLen = Math.floor(silenceDuration * this.sampleRate)
        const silence = new Array(silenceLen).fill(0)
        wavCat = [...wavCat, ...silence, ...wav]
        durCat += duration[0] + silenceDuration
      }
    }

    return { wav: wavCat ?? [], duration: durCat }
  }
}

// --- Voice style loading ---

function loadVoiceStyle(
  ort: OrtModule,
  voiceStylePath: string,
): StyleData {
  const voiceStyle = JSON.parse(fs.readFileSync(voiceStylePath, "utf8"))

  const ttlDims = voiceStyle.style_ttl.dims as number[]
  const dpDims = voiceStyle.style_dp.dims as number[]

  const ttlData = (voiceStyle.style_ttl.data as number[][][]).flat(
    Infinity,
  ) as number[]
  const dpData = (voiceStyle.style_dp.data as number[][][]).flat(
    Infinity,
  ) as number[]

  // Single voice: batch size = 1
  const ttlTensor = new ort.Tensor(
    "float32",
    Float32Array.from(ttlData),
    [1, ttlDims[1], ttlDims[2]],
  )
  const dpTensor = new ort.Tensor(
    "float32",
    Float32Array.from(dpData),
    [1, dpDims[1], dpDims[2]],
  )

  return { ttl: ttlTensor, dp: dpTensor }
}

// --- Engine initialization ---

async function initializeEngine(): Promise<TextToSpeech> {
  if (ttsEngine) return ttsEngine

  if (!isModelReady()) {
    throw new Error(
      "Supertonic model not downloaded. Call downloadSupertonicModel() first.",
    )
  }

  const ort = await loadOrt()
  const onnxDir = getOnnxDir()

  // Load config
  const cfgs: TtsConfig = JSON.parse(
    fs.readFileSync(path.join(onnxDir, "tts.json"), "utf8"),
  )

  // Load text processor
  const textProcessor = new UnicodeProcessor(
    path.join(onnxDir, "unicode_indexer.json"),
  )

  // Load all ONNX models
  console.log("[Supertonic] Loading ONNX models...")
  const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
    ort.InferenceSession.create(
      path.join(onnxDir, "duration_predictor.onnx"),
    ),
    ort.InferenceSession.create(path.join(onnxDir, "text_encoder.onnx")),
    ort.InferenceSession.create(
      path.join(onnxDir, "vector_estimator.onnx"),
    ),
    ort.InferenceSession.create(path.join(onnxDir, "vocoder.onnx")),
  ])

  ttsEngine = new TextToSpeech(
    ort,
    cfgs,
    textProcessor,
    dpOrt,
    textEncOrt,
    vectorEstOrt,
    vocoderOrt,
  )
  console.log("[Supertonic] TTS engine initialized successfully")
  return ttsEngine
}

// --- Public API ---

/**
 * Synthesize speech from text using Supertonic.
 * @param text - The text to synthesize
 * @param voice - Voice style ID (e.g., "M1", "F1")
 * @param lang - Language code (en, ko, es, pt, fr)
 * @param speed - Speech speed multiplier (default: 1.05)
 * @param steps - Denoising steps (default: 5, higher = better quality)
 */
export async function synthesize(
  text: string,
  voice = "M1",
  lang = "en",
  speed = 1.05,
  steps = 5,
): Promise<SupertonicSynthesisResult> {
  // Validate speed: must be finite and positive to avoid Infinity/NaN in duration calc
  if (!Number.isFinite(speed) || speed <= 0) {
    speed = 1.05
  }
  speed = Math.max(0.25, Math.min(4.0, speed))

  // Validate steps: clamp to safe range (2-10) to prevent excessive compute
  if (!Number.isFinite(steps) || steps < 1) {
    steps = 5
  }
  steps = Math.max(2, Math.min(10, Math.round(steps)))

  const engine = await initializeEngine()
  const ort = await loadOrt()

  // Load voice style
  const voiceStylePath = path.join(getVoiceStylesDir(), `${voice}.json`)
  if (!fs.existsSync(voiceStylePath)) {
    throw new Error(
      `Voice style not found: ${voice}. Available: M1-M5, F1-F5`,
    )
  }

  const style = loadVoiceStyle(ort, voiceStylePath)

  const { wav, duration } = await engine.synthesizeSingle(
    text,
    lang,
    style,
    steps,
    speed,
  )

  // Trim to actual audio length
  const wavLen = Math.floor(engine.sampleRate * duration)
  const trimmedWav = wav.slice(0, wavLen)

  return {
    samples: Float32Array.from(trimmedWav),
    sampleRate: engine.sampleRate,
  }
}

/**
 * Get available voice styles
 */
export function getAvailableVoices(): Array<{
  id: string
  label: string
  gender: string
}> {
  return [
    { id: "M1", label: "Male 1", gender: "male" },
    { id: "M2", label: "Male 2", gender: "male" },
    { id: "M3", label: "Male 3", gender: "male" },
    { id: "M4", label: "Male 4", gender: "male" },
    { id: "M5", label: "Male 5", gender: "male" },
    { id: "F1", label: "Female 1", gender: "female" },
    { id: "F2", label: "Female 2", gender: "female" },
    { id: "F3", label: "Female 3", gender: "female" },
    { id: "F4", label: "Female 4", gender: "female" },
    { id: "F5", label: "Female 5", gender: "female" },
  ]
}

/**
 * Dispose of the TTS engine to free resources
 */
export function disposeTts(): void {
  ttsEngine = null
}
