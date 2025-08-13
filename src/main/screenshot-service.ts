import { desktopCapturer, nativeImage, clipboard } from "electron"
import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"
import { ImageContent } from "../shared/types"

/**
 * Capture a screenshot of the primary display
 */
export async function captureScreenshot(): Promise<ImageContent | null> {
  try {
    const config = configStore.get()
    
    if (!config.screenshotEnabled) {
      return null
    }

    // Get available sources (screens)
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: config.maxImageSize || 1920,
        height: config.maxImageSize || 1920,
      },
    })

    if (sources.length === 0) {
      throw new Error("No screen sources available")
    }

    // Use the primary screen (first source)
    const primarySource = sources[0]
    const screenshot = primarySource.thumbnail

    // Compress the image
    const compressedImage = await compressImage(screenshot, config.screenshotQuality || 0.7)

    return {
      type: "image",
      data: compressedImage,
      mimeType: "image/jpeg",
      source: "screenshot",
    }
  } catch (error) {
    diagnosticsService.logError("screenshot-service", "Failed to capture screenshot", error)
    return null
  }
}

/**
 * Get image from clipboard if available
 */
export function getClipboardImage(): ImageContent | null {
  try {
    const config = configStore.get()
    
    if (!config.clipboardImageEnabled) {
      return null
    }

    const image = clipboard.readImage()
    
    if (image.isEmpty()) {
      return null
    }

    // Compress the image
    const compressedData = compressImageSync(image, config.screenshotQuality || 0.7)

    return {
      type: "image",
      data: compressedData,
      mimeType: "image/jpeg",
      source: "clipboard",
    }
  } catch (error) {
    diagnosticsService.logError("screenshot-service", "Failed to get clipboard image", error)
    return null
  }
}

/**
 * Compress image asynchronously
 */
async function compressImage(image: Electron.NativeImage, quality: number): Promise<string> {
  return new Promise((resolve) => {
    // Convert to JPEG with compression
    const jpegBuffer = image.toJPEG(Math.round(quality * 100))
    const base64Data = jpegBuffer.toString("base64")
    resolve(base64Data)
  })
}

/**
 * Compress image synchronously
 */
function compressImageSync(image: Electron.NativeImage, quality: number): string {
  // Convert to JPEG with compression
  const jpegBuffer = image.toJPEG(Math.round(quality * 100))
  return jpegBuffer.toString("base64")
}

/**
 * Resize image if it exceeds maximum dimensions
 */
function resizeImageIfNeeded(image: Electron.NativeImage, maxSize: number): Electron.NativeImage {
  const size = image.getSize()
  const maxDimension = Math.max(size.width, size.height)
  
  if (maxDimension <= maxSize) {
    return image
  }
  
  const scale = maxSize / maxDimension
  const newWidth = Math.round(size.width * scale)
  const newHeight = Math.round(size.height * scale)
  
  return image.resize({ width: newWidth, height: newHeight })
}

/**
 * Check if visual context is supported for the given provider
 */
export function isVisualContextSupported(providerId: string): boolean {
  // Only OpenAI and Gemini support vision
  return providerId === "openai" || providerId === "gemini"
}

/**
 * Get clipboard text content
 */
export function getClipboardText(): string {
  try {
    return clipboard.readText()
  } catch (error) {
    diagnosticsService.logError("screenshot-service", "Failed to get clipboard text", error)
    return ""
  }
}
