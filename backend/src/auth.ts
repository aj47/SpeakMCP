// Authentication worker - handles Google OAuth and JWT tokens
import { Env, GoogleTokenResponse, GoogleUserInfo } from './shared/types';
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

      if (path === '/auth/google') {
        return handleGoogleAuth(env, request);
      }

      if (path === '/auth/callback') {
        return handleGoogleCallback(request, env, jwt, db);
      }

      if (path === '/auth/me') {
        return handleGetUser(request, jwt, db);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Auth error:', error);
      return new Response('Internal Server Error', {
        status: 500,
        headers: corsHeaders
      });
    }
  },
};

function handleGoogleAuth(env: Env, request: Request): Response {
  const url = new URL(request.url);
  const electronCallbackUrl = url.searchParams.get('callback');

  // Use production worker URL for OAuth callback
  const redirectUri = 'https://speakmcp-auth.techfren.workers.dev/auth/callback';

  // Store the Electron callback URL in the state parameter
  const state = electronCallbackUrl ? encodeURIComponent(electronCallbackUrl) : '';

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state: state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  return Response.redirect(authUrl, 302);
}

async function handleGoogleCallback(
  request: Request,
  env: Env,
  jwt: JWT,
  db: Database
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      return new Response('Missing authorization code', { status: 400 });
    }

    console.log('OAuth callback received with code:', code.substring(0, 20) + '...');

    // Decode the Electron callback URL from the state parameter
    const electronCallbackUrl = state ? decodeURIComponent(state) : 'http://localhost:8789/auth/callback';

  // Use production worker URL for OAuth callback
  const redirectUri = 'https://speakmcp-auth.techfren.workers.dev/auth/callback';

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    console.error('Token exchange failed:', await tokenResponse.text());
    return new Response('Token exchange failed', { status: 400 });
  }

  const tokens: GoogleTokenResponse = await tokenResponse.json();
  console.log('Token exchange successful');

  if (!tokens.access_token) {
    console.error('No access token received');
    return new Response('No access token received', { status: 400 });
  }

  // Get user info
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userResponse.ok) {
    console.error('Failed to get user info:', await userResponse.text());
    return new Response('Failed to get user info', { status: 400 });
  }

  const googleUser: GoogleUserInfo = await userResponse.json();
  console.log('Google user info:', googleUser);

  // Google returns user ID in either 'sub' or 'id' field depending on the endpoint
  const userId = googleUser.sub || googleUser.id;
  if (!userId) {
    console.error('No user ID received from Google');
    return new Response('Invalid user data from Google', { status: 400 });
  }

  // Create or update user
  console.log('About to call db.getUser with:', userId, typeof userId);
  let user = await db.getUser(userId);
  if (!user) {
    user = await db.createUser({
      id: userId,
      email: googleUser.email,
      name: googleUser.name,
      avatar_url: googleUser.picture,
    });
  } else {
    await db.updateUser(userId, {
      name: googleUser.name,
      avatar_url: googleUser.picture,
    });
  }

    // Generate JWT
    const token = await jwt.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
    });

    // Redirect back to Electron app with token
    const finalCallbackUrl = `${electronCallbackUrl}?token=${encodeURIComponent(token)}`;
    console.log('Redirecting to Electron app:', finalCallbackUrl);
    return Response.redirect(finalCallbackUrl, 302);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response(`Authentication failed: ${(error as Error).message}`, { status: 500 });
  }
}

async function handleGetUser(request: Request, jwt: JWT, db: Database): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = authHeader.slice(7);
  const payload = await jwt.verify(token);

  if (!payload) {
    return new Response('Invalid token', { status: 401 });
  }

  const user = await db.getUser(payload.sub);
  if (!user) {
    return new Response('User not found', { status: 404 });
  }

  return new Response(JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
  });
}
