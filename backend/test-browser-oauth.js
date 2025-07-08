#!/usr/bin/env node

// Test the new browser-based OAuth flow
// Run with: node test-browser-oauth.js

const http = require('http');
const { URL } = require('url');

console.log('🧪 Testing Browser-to-Electron OAuth Flow\n');

// Create a temporary HTTP server to simulate Electron's callback server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  
  console.log(`📥 Received callback: ${req.url}`);
  
  if (url.pathname === '/auth/callback') {
    const token = url.searchParams.get('token');
    const error = url.searchParams.get('error');
    
    if (error) {
      console.log(`❌ Authentication failed: ${error}`);
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>Authentication Failed</h1>
            <p>Error: ${error}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      server.close();
      return;
    }
    
    if (token) {
      console.log(`✅ Authentication successful!`);
      console.log(`🎫 Token received: ${token.substring(0, 50)}...`);
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>Authentication Successful!</h1>
            <p>You can close this window and return to SpeakMCP.</p>
            <script>
              // Auto-close after 2 seconds
              setTimeout(() => window.close(), 2000)
            </script>
          </body>
        </html>
      `);
      
      server.close();
      console.log('\n🎉 OAuth flow completed successfully!');
      console.log('The token would now be saved to the Electron app.');
    } else {
      console.log('❌ No token received');
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>Authentication Failed</h1>
            <p>No token received</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      server.close();
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Start server on a random available port
server.listen(0, 'localhost', () => {
  const address = server.address();
  const port = address?.port;
  
  if (!port) {
    console.log('❌ Failed to start local server');
    return;
  }
  
  console.log(`🚀 Local callback server started on port ${port}`);
  
  // Create OAuth URL with our local callback
  const callbackUrl = `http://localhost:${port}/auth/callback`;
  const authUrl = `http://localhost:8787/auth/google?callback=${encodeURIComponent(callbackUrl)}`;
  
  console.log(`\n📋 Test Instructions:`);
  console.log(`1. Make sure the backend server is running on localhost:8787`);
  console.log(`2. Open this URL in your browser:`);
  console.log(`   ${authUrl}`);
  console.log(`3. Complete the Google OAuth flow`);
  console.log(`4. You should be redirected back to this local server`);
  console.log(`\n⏳ Waiting for OAuth callback...`);
  
  // Set a timeout to close the server if no response
  setTimeout(() => {
    if (server.listening) {
      console.log('\n⏰ Timeout - no response received after 5 minutes');
      server.close();
    }
  }, 300000); // 5 minutes timeout
});

server.on('error', (error) => {
  console.log(`❌ Server error: ${error.message}`);
});
