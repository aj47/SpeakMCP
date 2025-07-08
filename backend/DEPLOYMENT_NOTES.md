# SpeakMCP Backend Deployment Notes

## Production Deployment Configuration

### Required Environment Variables

The following environment variables must be configured in the Cloudflare Workers dashboard or via `wrangler secret put`:

#### Auth Worker (`speakmcp-auth`)
```bash
# JWT Secret (generate a secure 256-bit key)
wrangler secret put JWT_SECRET --config wrangler-auth.toml

# Google OAuth Credentials (from Google Cloud Console)
wrangler secret put GOOGLE_CLIENT_ID --config wrangler-auth.toml
wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler-auth.toml
```

#### Proxy Worker (`speakmcp-proxy`)
```bash
# JWT Secret (same as auth worker)
wrangler secret put JWT_SECRET --config wrangler-proxy.toml

# Groq API Key (from https://console.groq.com/keys)
wrangler secret put GROQ_API_KEY --config wrangler-proxy.toml
```

### Google OAuth Configuration

Add these redirect URIs to your Google OAuth application:

- Production: `https://speakmcp-auth.techfren.workers.dev/auth/callback`
- Development: `http://localhost:8787/auth/callback`

### Deployment Commands

```bash
# Deploy auth worker
npm run deploy:auth

# Deploy proxy worker  
npm run deploy:proxy

# Deploy both (full deployment)
./deploy.sh
```

### Production URLs

- **Auth Worker**: `https://speakmcp-auth.techfren.workers.dev`
- **Proxy Worker**: `https://speakmcp-proxy.techfren.workers.dev`

### Security Notes

- Never commit real API keys or secrets to the repository
- Use `wrangler secret put` for sensitive environment variables
- The `.env.local` file is for local development only
- Production secrets are managed separately in Cloudflare Workers

### Testing Production Deployment

```bash
# Test auth endpoint
curl "https://speakmcp-auth.techfren.workers.dev/auth/google?callback=http://localhost:3000/test"

# Test auth validation (should return 401)
curl "https://speakmcp-auth.techfren.workers.dev/auth/me"

# Test proxy endpoint (should return 401)
curl "https://speakmcp-proxy.techfren.workers.dev/openai/v1/chat/completions"
```

### Current Status

✅ **Auth Worker**: Deployed and functional  
✅ **Proxy Worker**: Deployed and functional  
✅ **OAuth Flow**: Working with production URLs  
✅ **Database**: Migrations applied  
⚠️ **Secrets**: Must be configured manually for production
