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
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SpeakMCP - Authentication Failed</title>
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }

              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                animation: fadeIn 0.6s ease-out;
              }

              .container {
                text-align: center;
                padding: 3rem 2rem;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                max-width: 400px;
                width: 100%;
                animation: slideUp 0.8s ease-out;
              }

              .error-icon {
                font-size: 4rem;
                margin-bottom: 1.5rem;
                animation: shake 0.8s ease-out;
              }

              h1 {
                font-size: 2rem;
                font-weight: 600;
                margin-bottom: 1rem;
                letter-spacing: -0.02em;
              }

              .brand {
                color: #fca5a5;
                font-weight: 700;
              }

              p {
                font-size: 1.1rem;
                opacity: 0.9;
                line-height: 1.6;
                margin-bottom: 1rem;
              }

              .error-details {
                background: rgba(0, 0, 0, 0.2);
                padding: 1rem;
                border-radius: 10px;
                font-family: monospace;
                font-size: 0.9rem;
                margin-bottom: 1rem;
                word-break: break-word;
              }

              @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }

              @keyframes slideUp {
                from {
                  opacity: 0;
                  transform: translateY(30px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }

              @keyframes shake {
                0%, 100% { transform: translateX(0); }
                10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                20%, 40%, 60%, 80% { transform: translateX(5px); }
              }

              @media (max-width: 480px) {
                .container {
                  margin: 1rem;
                  padding: 2rem 1.5rem;
                }

                h1 {
                  font-size: 1.5rem;
                }

                .error-icon {
                  font-size: 3rem;
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error-icon">❌</div>
              <h1><span class="brand">SpeakMCP</span> Authentication Failed</h1>
              <p>We encountered an issue during authentication:</p>
              <div class="error-details">${error}</div>
              <p>Please close this window and try again.</p>
            </div>
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
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SpeakMCP - Authentication Successful</title>
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }

              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                animation: fadeIn 0.6s ease-out;
              }

              .container {
                text-align: center;
                padding: 3rem 2rem;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                max-width: 400px;
                width: 100%;
                animation: slideUp 0.8s ease-out;
              }

              .success-icon {
                font-size: 4rem;
                margin-bottom: 1.5rem;
                animation: bounce 1s ease-out;
              }

              .microphone-icon {
                font-size: 2rem;
                margin-bottom: 1rem;
                opacity: 0.8;
                animation: pulse 2s infinite;
              }

              h1 {
                font-size: 2rem;
                font-weight: 600;
                margin-bottom: 1rem;
                letter-spacing: -0.02em;
              }

              .brand {
                color: #60a5fa;
                font-weight: 700;
              }

              p {
                font-size: 1.1rem;
                opacity: 0.9;
                line-height: 1.6;
                margin-bottom: 2rem;
              }

              .auto-close {
                font-size: 0.9rem;
                opacity: 0.7;
                font-style: italic;
              }

              @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }

              @keyframes slideUp {
                from {
                  opacity: 0;
                  transform: translateY(30px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }

              @keyframes bounce {
                0%, 20%, 53%, 80%, 100% {
                  transform: translate3d(0, 0, 0);
                }
                40%, 43% {
                  transform: translate3d(0, -15px, 0);
                }
                70% {
                  transform: translate3d(0, -7px, 0);
                }
                90% {
                  transform: translate3d(0, -2px, 0);
                }
              }

              @keyframes pulse {
                0%, 100% {
                  transform: scale(1);
                  opacity: 0.8;
                }
                50% {
                  transform: scale(1.1);
                  opacity: 1;
                }
              }

              @media (max-width: 480px) {
                .container {
                  margin: 1rem;
                  padding: 2rem 1.5rem;
                }

                h1 {
                  font-size: 1.5rem;
                }

                .success-icon {
                  font-size: 3rem;
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="microphone-icon">🎤</div>
              <div class="success-icon">✅</div>
              <h1>Welcome to <span class="brand">SpeakMCP</span>!</h1>
              <p>Authentication successful! You can now close this window and start using voice-to-text with AI-powered transcription.</p>
              <p class="auto-close">This window will close automatically in 5 seconds...</p>
            </div>
            <script>
              // Auto-close after 5 seconds with countdown
              let countdown = 5;
              const autoCloseElement = document.querySelector('.auto-close');

              const updateCountdown = () => {
                if (countdown > 0) {
                  autoCloseElement.textContent = \`This window will close automatically in \${countdown} second\${countdown !== 1 ? 's' : ''}...\`;
                  countdown--;
                  setTimeout(updateCountdown, 1000);
                } else {
                  // Try multiple methods to close the window
                  try {
                    // Method 1: Standard window.close()
                    window.close();
                  } catch (e) {
                    console.log('Standard window.close() failed:', e);
                  }

                  // Method 2: Try to close via opener
                  try {
                    if (window.opener) {
                      window.opener.focus();
                      window.close();
                    }
                  } catch (e) {
                    console.log('Opener close failed:', e);
                  }

                  // Method 3: Fallback - show manual close message
                  setTimeout(() => {
                    autoCloseElement.innerHTML = 'Please close this window manually. <br><small>You can now return to SpeakMCP.</small>';
                    autoCloseElement.style.color = '#ffd700';
                    autoCloseElement.style.fontWeight = 'bold';
                  }, 1000);
                }
              };

              setTimeout(updateCountdown, 1000);
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
