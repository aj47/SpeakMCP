#!/bin/bash
# Setup script for the Autonomous UI/UX Audit Agent

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "============================================"
echo "  SpeakMCP Audit Agent Setup"
echo "============================================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "   Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher (current: $(node -v))"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed"
    echo "   Installing pnpm..."
    npm install -g pnpm@9.12.1
fi

echo "✅ pnpm $(pnpm -v) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
pnpm install

# Install audit agent dependencies
echo ""
echo "📦 Installing audit agent dependencies..."
pnpm add -D @anthropic-ai/claude-agent-sdk tsx

echo "✅ Dependencies installed"

# Setup environment file
echo ""
if [ ! -f ".env.audit" ]; then
    echo "📝 Creating .env.audit file..."
    cp .env.audit.example .env.audit
    echo "✅ Created .env.audit"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env.audit and add your ANTHROPIC_API_KEY"
    echo "   Get your API key from: https://console.anthropic.com/"
    echo ""
else
    echo "✅ .env.audit already exists"
fi

# Check for API key
if grep -q "your-api-key-here" .env.audit 2>/dev/null; then
    echo ""
    echo "⚠️  WARNING: ANTHROPIC_API_KEY not configured!"
    echo "   Edit .env.audit and add your API key before running the agent."
    echo ""
else
    echo "✅ ANTHROPIC_API_KEY appears to be configured"
fi

# Make scripts executable
chmod +x scripts/audit-agent.ts
chmod +x scripts/audit-scheduler.ts
chmod +x scripts/setup-audit-agent.sh

echo ""
echo "============================================"
echo "  ✅ Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Edit .env.audit and add your ANTHROPIC_API_KEY"
echo "   export ANTHROPIC_API_KEY='your-key-here'"
echo ""
echo "2. Run a single audit:"
echo "   source .env.audit && pnpm run audit:agent"
echo ""
echo "3. Or start the scheduler (runs every 30 min):"
echo "   source .env.audit && pnpm run audit:scheduler"
echo ""
echo "4. View logs:"
echo "   tail -f audit-agent.log"
echo ""
echo "5. Read the full documentation:"
echo "   cat scripts/AUDIT_AGENT_README.md"
echo ""
echo "============================================"
