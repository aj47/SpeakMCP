import { FastifyPluginAsync } from 'fastify'
import { agentService } from '../services/agent-service.js'
import { configService } from '../services/config-service.js'
import { z } from 'zod'
import { nanoid } from 'nanoid'

const ChatCompletionBody = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  stream: z.boolean().default(false),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
})

export const openaiCompatRoutes: FastifyPluginAsync = async (server) => {
  // POST /v1/chat/completions - OpenAI-compatible endpoint
  server.post('/v1/chat/completions', async (request, reply) => {
    const body = ChatCompletionBody.parse(request.body)
    
    // Extract the last user message
    const lastUserMessage = body.messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      return reply.status(400).send({ error: 'No user message found' })
    }

    const requestId = `chatcmpl-${nanoid()}`
    const created = Math.floor(Date.now() / 1000)
    const model = body.model ?? configService.getKey('mcpToolsModelId') ?? 'gpt-4o-mini'

    if (body.stream) {
      // SSE streaming response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      const sendChunk = (content: string, finishReason: string | null = null) => {
        const chunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: finishReason ? {} : { content },
            finish_reason: finishReason,
          }],
        }
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }

      try {
        for await (const progress of agentService.process(lastUserMessage.content)) {
          if (progress.type === 'response' && progress.content) {
            // Send content in chunks
            const words = progress.content.split(' ')
            for (const word of words) {
              sendChunk(word + ' ')
            }
          }
          if (progress.type === 'done') {
            sendChunk('', 'stop')
            break
          }
          if (progress.type === 'error') {
            sendChunk('', 'stop')
            break
          }
        }
      } catch (error) {
        sendChunk('', 'stop')
      }

      reply.raw.write('data: [DONE]\n\n')
      reply.raw.end()
      return
    }

    // Non-streaming response
    let finalContent = ''
    let finishReason = 'stop'

    try {
      for await (const progress of agentService.process(lastUserMessage.content)) {
        if (progress.type === 'response' && progress.content) {
          finalContent = progress.content
        }
        if (progress.type === 'done' || progress.type === 'error') {
          if (progress.type === 'error') {
            finishReason = 'error'
          }
          break
        }
      }
    } catch (error) {
      finishReason = 'error'
      finalContent = error instanceof Error ? error.message : 'Unknown error'
    }

    return {
      id: requestId,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: finalContent,
        },
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    }
  })

  // GET /v1/models - List available models
  server.get('/v1/models', async () => {
    return {
      object: 'list',
      data: [
        { id: 'speakmcp-agent', object: 'model', created: 1700000000, owned_by: 'speakmcp' },
      ],
    }
  })
}

