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

## Development

```bash
# Local development
npm run dev

# Type checking
npm run type-check

# Local database migrations
npm run db:migrate:local
```
