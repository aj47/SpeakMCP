import { FastifyPluginAsync } from 'fastify'
import { speechService } from '../services/speech-service.js'
import { z } from 'zod'

const SpeakBody = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  model: z.string().optional(),
  providerId: z.enum(['openai', 'groq', 'gemini']).optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
  preprocess: z.boolean().optional(),
})

const TranscribeQuerystring = z.object({
  language: z.string().optional(),
  prompt: z.string().optional(),
  providerId: z.enum(['openai', 'groq']).optional(),
})

export const speechRoutes: FastifyPluginAsync = async (server) => {
  // POST /api/speech/transcribe - Transcribe audio (STT)
  server.post('/speech/transcribe', async (request, reply) => {
    // Handle multipart file upload
    const data = await request.file()
    
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' })
    }

    const query = TranscribeQuerystring.parse(request.query)
    
    // Read file buffer
    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)

    try {
      const text = await speechService.transcribe(buffer, data.filename, {
        language: query.language,
        prompt: query.prompt,
        providerId: query.providerId,
      })
      
      return { text, filename: data.filename }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Transcription failed',
      })
    }
  })

  // POST /api/speech/synthesize - Generate speech (TTS)
  server.post('/speech/synthesize', async (request, reply) => {
    const body = SpeakBody.parse(request.body)

    try {
      // Optionally preprocess text
      let text = body.text
      if (body.preprocess) {
        text = await speechService.preprocessForTTS(text)
      }

      const audioBuffer = await speechService.speak(text, {
        voice: body.voice,
        model: body.model,
        providerId: body.providerId,
        speed: body.speed,
      })

      // Return as audio file
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Content-Disposition', 'attachment; filename="speech.mp3"')
      return reply.send(audioBuffer)
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Speech synthesis failed',
      })
    }
  })

  // POST /api/speech/preprocess - Preprocess text for TTS without synthesizing
  server.post('/speech/preprocess', async (request, reply) => {
    const body = z.object({
      text: z.string().min(1),
    }).parse(request.body)

    try {
      const processed = await speechService.preprocessForTTS(body.text)
      return { original: body.text, processed }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Preprocessing failed',
      })
    }
  })
}

