// Minimal TypeScript types for SpeakMCP backend

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  created_at: number;
  updated_at: number;
}

export interface Usage {
  user_id: string;
  month: string;
  stt_seconds: number;
  chat_tokens: number;
}

export interface JWTPayload {
  sub: string;  // user id
  email: string;
  name?: string;
  iat: number;
  exp: number;
}

export interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token?: string;
}

export interface GoogleUserInfo {
  sub?: string;  // OpenID Connect standard field
  id?: string;   // Google's legacy field
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GROQ_API_KEY: string;
  ALLOWED_ORIGINS: string;
}

// Monthly quotas
export const QUOTAS = {
  FREE: {
    stt_seconds: 3600,    // 1 hour per month
    chat_tokens: 50000,   // 50k tokens per month
  }
} as const;
