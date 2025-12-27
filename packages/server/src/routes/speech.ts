import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { configService } from '../services/config-service.js'
import { ValidationError } from '../middleware/error-handler.js'

const TranscribeSchema = z.object({
  provider: z.enum(['openai', 'groq']).optional(),
  language: z.string().optional(),
})

const SynthesizeSchema = z.object({
  text: z.string().min(1),
  provider: z.enum(['openai', 'groq', 'gemini']).optional(),
  voice: z.string().optional(),
})

export const speechRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/speech/transcribe - Speech-to-text
  fastify.post('/transcribe', async (request, reply) => {
    // TODO: Handle multipart form data for audio upload
    // For now, return a stub response
    
    const config = await configService.get()
    const provider = config.sttProviderId || 'openai'

    return {
      success: false,
      error: 'Audio transcription not yet implemented. Requires multipart form data handling.',
      provider,
    }
  })

  // POST /api/speech/synthesize - Text-to-speech
  fastify.post('/synthesize', async (request, reply) => {
    const parseResult = SynthesizeSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid request', parseResult.error.errors)
    }

    const { text, provider: requestedProvider, voice } = parseResult.data
    const config = await configService.get()
    const provider = requestedProvider || config.ttsProviderId || 'openai'

    // TODO: Implement actual TTS
    // For now, return a stub response

    return {
      success: false,
      error: 'Text-to-speech not yet implemented. Requires provider integration.',
      provider,
      text: text.substring(0, 50),
    }
  })

  // POST /api/speech/preprocess - Preprocess text for TTS
  fastify.post('/preprocess', async (request) => {
    const body = request.body as { text?: string }
    
    if (!body.text || typeof body.text !== 'string') {
      throw new ValidationError('Missing or invalid text')
    }

    // Basic preprocessing: remove code blocks, clean up markdown
    let processed = body.text
    
    // Remove code blocks
    processed = processed.replace(/```[\s\S]*?```/g, '[code block removed]')
    processed = processed.replace(/`[^`]+`/g, '')
    
    // Remove URLs
    processed = processed.replace(/https?:\/\/[^\s]+/g, '[URL removed]')
    
    // Clean up markdown
    processed = processed.replace(/[*_~]+/g, '')
    processed = processed.replace(/#+\s*/g, '')
    
    // Clean up whitespace
    processed = processed.replace(/\n{3,}/g, '\n\n').trim()

    return { text: processed }
  })
}
