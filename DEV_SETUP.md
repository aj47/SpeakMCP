# SpeakMCP Local Development Setup

## Quick Start

**One command to rule them all:**

```bash
npm run dev:all
```

This starts:
- 🖥️  **Electron app** (main application)
- 🔐 **Auth worker** on `http://localhost:8787` (handles Google OAuth)
- 🔄 **Proxy worker** on `http://localhost:8788` (routes API calls to Groq)

## Prerequisites

1. **Node.js & pnpm** installed
2. **Google OAuth App** configured
3. **Groq API Key**

## Initial Setup

1. **Run the setup script:**
   ```bash
   ./setup-local.sh
   ```

2. **Configure environment variables:**
   Edit `backend/.env.local` with your actual credentials:
   ```bash
   # JWT Secret - Generate a secure random key
   JWT_SECRET=your-secure-jwt-secret-here
   
   # Google OAuth Credentials
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   
   # Groq API Key
   GROQ_API_KEY=your-groq-api-key
   
   # CORS Origins
   ALLOWED_ORIGINS=*
   ```

3. **Configure Google OAuth:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create/select a project
   - Enable Google+ API
   - Create OAuth 2.0 credentials (Web Application)
   - Add `http://localhost:8787/auth/callback` to authorized redirect URIs

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start everything (Electron + both workers) |
| `npm run dev` | Start only Electron app |
| `npm run dev:backend` | Start only backend workers |
| `npm run dev:auth` | Start only auth worker |
| `npm run dev:proxy` | Start only proxy worker |

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Electron App  │    │   Auth Worker   │    │  Proxy Worker   │
│                 │    │   :8787         │    │   :8788         │
│                 │────┤                 │    │                 │
│ • UI            │    │ • Google OAuth  │    │ • API Proxy     │
│ • Main Process  │    │ • JWT Tokens    │    │ • Groq API      │
│ • Renderer      │    │ • User Auth     │    │ • Usage Track   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Testing Authentication

1. Start all services: `npm run dev:all`
2. Open the Electron app
3. Try to use speech-to-text or any AI feature
4. You should be prompted to sign in with Google
5. After signing in, features should work normally

## Troubleshooting

**"Authentication required" errors:**
- Make sure auth worker is running on port 8787
- Check Google OAuth configuration
- Verify `.env.local` has correct credentials

**API call failures:**
- Make sure proxy worker is running on port 8788
- Check Groq API key in `.env.local`
- Verify CORS settings

**Database errors:**
- Run `cd backend && pnpm run db:migrate:local`
- Check if D1 database is properly initialized

## Production vs Development

| Environment | Auth URL | Proxy URL |
|-------------|----------|-----------|
| Development | `http://localhost:8787` | `http://localhost:8788` |
| Production | `https://api.speakmcp.com` | `https://api.speakmcp.com` |

The app automatically detects the environment and uses the appropriate URLs.
