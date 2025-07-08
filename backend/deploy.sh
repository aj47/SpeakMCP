#!/bin/bash
# Deployment script for SpeakMCP backend

set -e

echo "🚀 Deploying SpeakMCP Backend..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Please install it first:"
    echo "npm install -g wrangler"
    exit 1
fi

# Check if logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo "❌ Not logged in to Cloudflare. Please run:"
    echo "wrangler login"
    exit 1
fi

# Type check
echo "🔍 Type checking..."
npm run type-check

# Deploy database migrations
echo "📊 Applying database migrations..."
npm run db:migrate

# Deploy authentication worker
echo "🔐 Deploying authentication worker..."
npm run deploy:auth

# Deploy proxy worker
echo "🔄 Deploying proxy worker..."
npm run deploy:proxy

echo "✅ Deployment complete!"
echo ""
echo "🔗 Endpoints:"
echo "  Auth: https://api.speakmcp.com/auth/"
echo "  Proxy: https://api.speakmcp.com/openai/"
echo ""
echo "📝 Next steps:"
echo "  1. Update your Electron app to use the new auth endpoints"
echo "  2. Test the authentication flow"
echo "  3. Update API calls to use JWT tokens instead of API keys"
