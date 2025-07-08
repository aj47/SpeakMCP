#!/bin/bash

# SpeakMCP Local Development Setup Script
echo "🚀 Setting up SpeakMCP for local development..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the root directory of the SpeakMCP project"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Setup backend
echo "🔧 Setting up backend..."
cd backend
pnpm install

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local file not found in backend directory"
    echo "📝 Please create backend/.env.local with your environment variables"
    echo "   See backend/.env.local for template"
    exit 1
fi

# Initialize local database
echo "🗄️  Initializing local database..."
pnpm run db:migrate:local

cd ..

echo "✅ Setup complete!"
echo ""
echo "🎯 To start development:"
echo "   npm run dev:all"
echo ""
echo "This will start:"
echo "   • Electron app (port varies)"
echo "   • Auth worker (http://localhost:8787)"
echo "   • Proxy worker (http://localhost:8788)"
echo ""
echo "🔐 For authentication to work locally:"
echo "   1. Make sure your Google OAuth app has http://localhost:8787/auth/callback as a redirect URI"
echo "   2. Update backend/.env.local with your actual Google OAuth credentials"
echo "   3. Update backend/.env.local with your Groq API key"
