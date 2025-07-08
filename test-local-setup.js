#!/usr/bin/env node

// Simple test script to verify local development setup
const http = require('http');

console.log('🧪 Testing SpeakMCP local development setup...\n');

// Test function for HTTP endpoints
function testEndpoint(url, name) {
  return new Promise((resolve) => {
    const request = http.get(url, (res) => {
      console.log(`✅ ${name}: ${res.statusCode} ${res.statusMessage}`);
      resolve(true);
    });
    
    request.on('error', (err) => {
      console.log(`❌ ${name}: ${err.message}`);
      resolve(false);
    });
    
    request.setTimeout(5000, () => {
      console.log(`⏰ ${name}: Timeout (service may not be running)`);
      request.destroy();
      resolve(false);
    });
  });
}

async function runTests() {
  console.log('Testing backend services...\n');
  
  const tests = [
    { url: 'http://localhost:8787/auth/login', name: 'Auth Worker (port 8787)' },
    { url: 'http://localhost:8788/openai/v1/chat/completions', name: 'Proxy Worker (port 8788)' }
  ];
  
  let allPassed = true;
  
  for (const test of tests) {
    const passed = await testEndpoint(test.url, test.name);
    if (!passed) allPassed = false;
  }
  
  console.log('\n' + '='.repeat(50));
  
  if (allPassed) {
    console.log('🎉 All services are running!');
    console.log('\n💡 Next steps:');
    console.log('   1. Make sure your .env.local file has valid credentials');
    console.log('   2. Run: npm run dev:all');
    console.log('   3. Test authentication in the Electron app');
  } else {
    console.log('⚠️  Some services are not responding.');
    console.log('\n💡 To start all services:');
    console.log('   npm run dev:all');
    console.log('\n💡 To start services individually:');
    console.log('   npm run dev:auth    # Auth worker');
    console.log('   npm run dev:proxy   # Proxy worker');
  }
  
  console.log('\n📖 For detailed setup instructions, see DEV_SETUP.md');
}

runTests().catch(console.error);
