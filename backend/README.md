# SpeakMCP Backend - Minimal Cloudflare Workers

Ultra-minimal authentication and API proxy backend using Cloudflare Workers.

## Architecture

- **Cloudflare Workers** - Serverless functions at the edge
- **Cloudflare D1** - SQLite database at the edge
- **Google OAuth** - Authentication provider
- **JWT** - Stateless session management

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create D1 database**
   ```bash
   npm run db:create
   ```

3. **Update wrangler.toml with your database ID**

4. **Set environment variables**
   ```bash
   # Add to wrangler.toml [env.production.vars]
   JWT_SECRET="your-secure-jwt-secret"
   GOOGLE_CLIENT_ID="your-google-oauth-client-id"
   GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
   GROQ_API_KEY="your-groq-api-key"
   ```

5. **Run migrations**
   ```bash
   npm run db:migrate
   ```

6. **Deploy**
   ```bash
   npm run deploy:auth
   npm run deploy:proxy
   ```

## API Endpoints

### Authentication Worker
- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/callback` - OAuth callback
- `GET /auth/me` - Get current user (requires JWT)

### Proxy Worker
- `POST /openai/v1/audio/transcriptions` - STT proxy (requires JWT)
- `POST /openai/v1/chat/completions` - Chat proxy (requires JWT)

## Usage Quotas

**Free Tier:**
- STT: 1 hour per month
- Chat: 50,000 tokens per month

## Environment Setup

To run the backend workers locally, you need to create a `.env.local` file with your actual API credentials.

### Required Environment Variables

Create `backend/.env.local` with:

```bash
# JWT Secret for token signing (use a secure random string)
JWT_SECRET=your-secure-jwt-secret-here

# Google OAuth Credentials (from Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Groq API Key (from Groq Console)
GROQ_API_KEY=your-groq-api-key

# CORS Origins (use "*" for development)
ALLOWED_ORIGINS=*
```

### Setting up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Identity API
4. Go to Credentials → Create Credentials → OAuth 2.0 Client IDs
5. Choose "Web application"
6. Add authorized redirect URIs:
   - `http://localhost:8787/auth/callback` (for local development)

**Security Note:** Never commit `.env.local` or any files containing real API keys to Git.

## Development

```bash
# From main project directory
npm run dev:all

# Or just backend workers
npm run dev:auth    # Auth worker on port 8787
npm run dev:proxy   # Proxy worker on port 8788

# Type checking
npm run type-check

# Local database migrations
npm run db:migrate:local
```
