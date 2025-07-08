// API Proxy worker - authenticated proxy to Groq API with usage tracking
import { Env } from './shared/types';
import { JWT } from './shared/jwt';
import { Database } from './shared/db';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const jwt = new JWT(env.JWT_SECRET);
      const db = new Database(env.DB);

      // Authenticate user
      const user = await authenticateRequest(request, jwt);
      if (!user) {
        return new Response('Unauthorized', { 
          status: 401, 
          headers: corsHeaders 
        });
      }

      // Check quotas
      const quotas = await db.checkQuota(user.sub);

      if (path.startsWith('/openai/v1/audio/transcriptions')) {
        if (!quotas.canUseStt) {
          return new Response('STT quota exceeded', { 
            status: 429, 
            headers: corsHeaders 
          });
        }
        return handleSTTRequest(request, env, db, user.sub);
      }

      if (path.startsWith('/openai/v1/chat/completions')) {
        if (!quotas.canUseChat) {
          return new Response('Chat quota exceeded', { 
            status: 429, 
            headers: corsHeaders 
          });
        }
        return handleChatRequest(request, env, db, user.sub);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Proxy error:', error);
      return new Response('Internal Server Error', { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  },
};

async function authenticateRequest(request: Request, jwt: JWT) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  return await jwt.verify(token);
}

async function handleSTTRequest(
  request: Request, 
  env: Env, 
  db: Database, 
  userId: string
): Promise<Response> {
  // Clone request to forward to Groq
  const groqRequest = new Request('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: request.method,
    headers: {
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': request.headers.get('Content-Type') || '',
    },
    body: request.body,
  });

  const response = await fetch(groqRequest);
  
  if (response.ok) {
    // Estimate audio duration (rough approximation)
    const contentLength = parseInt(request.headers.get('Content-Length') || '0');
    const estimatedSeconds = Math.max(1, Math.floor(contentLength / 16000)); // Rough estimate
    
    // Track usage
    await db.addUsage(userId, estimatedSeconds, 0);
  }

  return response;
}

async function handleChatRequest(
  request: Request, 
  env: Env, 
  db: Database, 
  userId: string
): Promise<Response> {
  // Parse request to estimate token usage
  const body = await request.json();
  const estimatedTokens = estimateTokens(body);

  // Clone request to forward to Groq
  const groqRequest = new Request('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const response = await fetch(groqRequest);
  
  if (response.ok) {
    // Track usage
    await db.addUsage(userId, 0, estimatedTokens);
  }

  return response;
}

function estimateTokens(body: any): number {
  // Simple token estimation (4 chars ≈ 1 token)
  const text = JSON.stringify(body.messages || []);
  return Math.ceil(text.length / 4);
}
