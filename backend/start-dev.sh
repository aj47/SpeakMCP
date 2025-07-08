#!/bin/bash

# Load environment variables from .env.local
if [ -f .env.local ]; then
    export $(cat .env.local | grep -v '^#' | xargs)
fi

# Start auth worker in background
echo "Starting auth worker..."
wrangler dev --config wrangler-auth.toml --port 8787 --inspector-port 9229 &
AUTH_PID=$!

# Start proxy worker in background  
echo "Starting proxy worker..."
wrangler dev --config wrangler-proxy.toml --port 8788 --inspector-port 9230 &
PROXY_PID=$!

# Wait for both processes
wait $AUTH_PID $PROXY_PID
