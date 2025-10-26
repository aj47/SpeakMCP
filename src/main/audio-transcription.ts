import fs from "fs"
import path from "path"
import { configStore } from "./config"
import { logApp } from "./debug"
import { postProcessTranscript } from "./llm"

/**
 * Transcribe an audio file using the configured STT provider
 * @param filePath - Path to the audio file (can be relative or absolute)
 * @returns The transcribed text
 */
export async function transcribeAudioFile(filePath: string): Promise<string> {
  logApp(`Starting transcription for file: ${filePath}`)

  // Resolve the file path
  const resolvedPath = resolveAudioFilePath(filePath)
  
  // Verify file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Audio file not found: ${resolvedPath}`)
  }

  // Read the audio file
  const audioBuffer = fs.readFileSync(resolvedPath)
  
  // Get file extension to determine MIME type
  const ext = path.extname(resolvedPath).toLowerCase()
  const mimeType = getMimeType(ext)
  
  if (!mimeType) {
    throw new Error(`Unsupported audio file format: ${ext}`)
  }

  // Get configuration
  const config = configStore.get()

  // Prepare form data for transcription API
  const form = new FormData()
  const filename = path.basename(resolvedPath)

  // Create a File object from the buffer
  const file = new File([audioBuffer], filename, { type: mimeType })
  form.append("file", file)
  
  // Set model based on provider
  const model = config.sttProviderId === "groq" ? "whisper-large-v3" : "whisper-1"
  form.append("model", model)
  form.append("response_format", "json")

  // Add prompt parameter for Groq if provided
  if (config.sttProviderId === "groq" && config.groqSttPrompt?.trim()) {
    form.append("prompt", config.groqSttPrompt.trim())
  }

  // Add language parameter if specified
  const languageCode = config.sttProviderId === "groq"
    ? config.groqSttLanguage || config.sttLanguage
    : config.openaiSttLanguage || config.sttLanguage

  if (languageCode && languageCode !== "auto") {
    form.append("language", languageCode)
  }

  // Determine API endpoint and key
  const groqBaseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
  const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"
  
  const apiUrl = config.sttProviderId === "groq"
    ? `${groqBaseUrl}/audio/transcriptions`
    : `${openaiBaseUrl}/audio/transcriptions`
  
  const apiKey = config.sttProviderId === "groq" 
    ? config.groqApiKey 
    : config.openaiApiKey

  if (!apiKey) {
    throw new Error(`API key not configured for ${config.sttProviderId}`)
  }

  // Make the transcription request
  logApp(`Sending transcription request to ${config.sttProviderId}`)
  
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form as any,
  })

  if (!response.ok) {
    const errorText = await response.text()
    const message = `${response.statusText} ${errorText.slice(0, 300)}`
    throw new Error(message)
  }

  const json: { text: string } = await response.json()
  
  // Post-process the transcript
  const transcript = await postProcessTranscript(json.text)
  
  logApp(`Transcription completed: ${transcript.slice(0, 100)}...`)
  
  return transcript
}

/**
 * Resolve audio file path (handle relative paths, ~, etc.)
 */
function resolveAudioFilePath(filePath: string): string {
  // Handle home directory shorthand
  if (filePath.startsWith("~")) {
    const { app } = require("electron")
    const homeDir = app.getPath("home")
    return path.join(homeDir, filePath.slice(1))
  }
  
  // If absolute path, return as-is
  if (path.isAbsolute(filePath)) {
    return filePath
  }
  
  // Try common locations for relative paths
  const { app } = require("electron")
  const homeDir = app.getPath("home")
  const desktopDir = path.join(homeDir, "Desktop")
  const downloadsDir = app.getPath("downloads")
  const documentsDir = app.getPath("documents")
  
  // Check in order: Desktop, Downloads, Documents, Home
  const searchPaths = [
    path.join(desktopDir, filePath),
    path.join(downloadsDir, filePath),
    path.join(documentsDir, filePath),
    path.join(homeDir, filePath),
    filePath, // Current working directory
  ]
  
  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      return searchPath
    }
  }
  
  // If not found anywhere, return the original path (will fail with better error)
  return filePath
}

/**
 * Get MIME type for audio file extension
 */
function getMimeType(ext: string): string | null {
  const mimeTypes: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/m4a",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".opus": "audio/opus",
  }
  
  return mimeTypes[ext] || null
}

