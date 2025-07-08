#!/usr/bin/env node

// Simple OAuth flow tester for debugging
// Run with: node test-oauth.js

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testOAuthFlow() {
  console.log('🔍 OAuth Flow Debugger\n');
  
  // Step 1: Show the auth URL
  const authUrl = 'http://localhost:8787/auth/google';
  console.log('1. Open this URL in your browser:');
  console.log(`   ${authUrl}\n`);
  
  // Step 2: Get the callback URL
  console.log('2. After completing OAuth, you should be redirected to:');
  console.log('   http://localhost:8787/auth/callback?code=...\n');
  
  console.log('3. If you see an error, check:');
  console.log('   - Google OAuth app has http://localhost:8787/auth/callback as redirect URI');
  console.log('   - Google OAuth app has http://localhost:8787 as authorized origin');
  console.log('   - Wrangler dev server is running on port 8787\n');
  
  rl.question('Press Enter to continue or Ctrl+C to exit...', () => {
    console.log('\n📋 Debugging Checklist:');
    console.log('□ Google OAuth redirect URI configured');
    console.log('□ Wrangler dev server running');
    console.log('□ Environment variables loaded');
    console.log('□ Database migrations applied');
    
    rl.close();
  });
}

testOAuthFlow().catch(console.error);
