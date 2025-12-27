import { z } from 'zod'

const envSchema = z.object({
  PORT: z.string().default('3456').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  API_KEY: z.string().default('dev-api-key'),
  DATABASE_PATH: z.string().default('./data/speakmcp.db'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
  GEMINI_API_KEY: z.string().optional(),
})

const env = envSchema.parse(process.env)

export const config = {
  port: env.PORT,
  host: env.HOST,
  apiKey: env.API_KEY,
  databasePath: env.DATABASE_PATH,
  openai: {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
  },
  groq: {
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
  },
}

export type Config = typeof config

