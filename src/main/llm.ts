import { GoogleGenerativeAI } from "@google/generative-ai"
import { configStore } from "./config"

export async function postProcessTranscript(transcript: string) {
  const config = configStore.get()

  if (
    !config.transcriptPostProcessingEnabled ||
    !config.transcriptPostProcessingPrompt
  ) {
    return transcript
  }

  const prompt = config.transcriptPostProcessingPrompt.replace(
    "{transcript}",
    transcript,
  )

  // Use proxy server for all chat completions
  if (!config.authToken) {
    throw new Error("Authentication required. Please sign in to use SpeakMCP.")
  }

  const isDevelopment = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged
  const baseUrl = isDevelopment
    ? "http://localhost:8788"  // Proxy worker port
    : "https://speakmcp-proxy.techfren.workers.dev"

  const chatResponse = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      temperature: 0,
      model: "gemma2-9b-it", // Default to Groq model via proxy
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
    }),
  })

  if (!chatResponse.ok) {
    const message = `${chatResponse.statusText} ${(await chatResponse.text()).slice(0, 300)}`

    throw new Error(message)
  }

  const chatJson = await chatResponse.json()
  return chatJson.choices[0].message.content.trim()
}
