#!/usr/bin/env node

// Configuration checker for OAuth setup
// Run with: node check-config.js

const fs = require('fs');
const path = require('path');

function checkConfig() {
  console.log('🔧 Configuration Checker\n');
  
  // Check .env.local file
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    console.log('✅ .env.local file exists');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    // Check required variables
    const requiredVars = [
      'JWT_SECRET',
      'GOOGLE_CLIENT_ID', 
      'GOOGLE_CLIENT_SECRET',
      'GROQ_API_KEY'
    ];
    
    requiredVars.forEach(varName => {
      if (envContent.includes(`${varName}=`) && !envContent.includes(`${varName}=your-`)) {
        console.log(`✅ ${varName} is configured`);
      } else {
        console.log(`❌ ${varName} is missing or not configured`);
      }
    });
  } else {
    console.log('❌ .env.local file not found');
  }
  
  console.log('\n📋 OAuth Configuration Requirements:');
  console.log('1. Google Cloud Console > APIs & Services > Credentials');
  console.log('2. Your OAuth 2.0 Client ID should have:');
  console.log('   - Authorized JavaScript origins: http://localhost:8787');
  console.log('   - Authorized redirect URIs: http://localhost:8787/auth/callback');
  console.log('\n3. Common OAuth Errors:');
  console.log('   - "invalid_grant" = Redirect URI mismatch or expired code');
  console.log('   - "unauthorized_client" = Client ID/secret mismatch');
  console.log('   - "access_denied" = User denied permission');
  
  console.log('\n🚀 Next Steps:');
  console.log('1. Update Google OAuth settings with localhost URLs');
  console.log('2. Restart wrangler dev server: npm run dev');
  console.log('3. Test OAuth flow: node test-oauth.js');
}

checkConfig();
