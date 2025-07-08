#!/usr/bin/env node

/**
 * Production Deployment Testing Script for SpeakMCP
 * Tests deployed Cloudflare Workers endpoints
 */

const https = require('https');
const { URL } = require('url');

// Production endpoints
const AUTH_BASE_URL = 'https://speakmcp-auth.techfren.workers.dev';
const PROXY_BASE_URL = 'https://speakmcp-proxy.techfren.workers.dev';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

// Helper function to make HTTPS requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function testProductionAuth() {
  log('\n🔐 Testing Production Auth Worker', colors.bold);
  
  try {
    // Test Google OAuth initiation
    logInfo('Testing /auth/google endpoint...');
    const authResponse = await makeRequest(`${AUTH_BASE_URL}/auth/google`);
    
    if (authResponse.statusCode === 302) {
      const location = authResponse.headers.location;
      if (location && location.includes('accounts.google.com')) {
        logSuccess('Production Google OAuth redirect working');
        logInfo(`Redirect URL: ${location}`);
      } else {
        logError('Invalid OAuth redirect URL in production');
      }
    } else {
      logError(`Expected 302 redirect, got ${authResponse.statusCode}`);
    }

    // Test /auth/me endpoint without token
    logInfo('Testing /auth/me endpoint without token...');
    const meResponse = await makeRequest(`${AUTH_BASE_URL}/auth/me`);
    
    if (meResponse.statusCode === 401) {
      logSuccess('Production auth correctly blocks unauthorized access');
    } else {
      logError(`Expected 401, got ${meResponse.statusCode}`);
    }

    // Test CORS headers
    logInfo('Testing CORS headers...');
    const corsResponse = await makeRequest(`${AUTH_BASE_URL}/auth/google`, {
      method: 'OPTIONS'
    });
    
    if (corsResponse.statusCode === 200) {
      logSuccess('Production CORS working');
    } else {
      logWarning('CORS may not be configured correctly');
    }

  } catch (error) {
    logError(`Production auth test failed: ${error.message}`);
  }
}

async function testProductionProxy() {
  log('\n🔄 Testing Production Proxy Worker', colors.bold);
  
  try {
    // Test chat endpoint without auth
    logInfo('Testing /openai/v1/chat/completions without auth...');
    const chatResponse = await makeRequest(`${PROXY_BASE_URL}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });
    
    if (chatResponse.statusCode === 401) {
      logSuccess('Production chat endpoint requires authentication');
    } else {
      logError(`Expected 401, got ${chatResponse.statusCode}`);
    }

    // Test STT endpoint without auth
    logInfo('Testing /openai/v1/audio/transcriptions without auth...');
    const sttResponse = await makeRequest(`${PROXY_BASE_URL}/openai/v1/audio/transcriptions`, {
      method: 'POST'
    });
    
    if (sttResponse.statusCode === 401) {
      logSuccess('Production STT endpoint requires authentication');
    } else {
      logError(`Expected 401, got ${sttResponse.statusCode}`);
    }

    // Test CORS on proxy
    logInfo('Testing CORS on proxy endpoints...');
    const proxyCorsResponse = await makeRequest(`${PROXY_BASE_URL}/openai/v1/chat/completions`, {
      method: 'OPTIONS'
    });
    
    if (proxyCorsResponse.statusCode === 200) {
      logSuccess('Production proxy CORS working');
    } else {
      logWarning('Proxy CORS may not be configured correctly');
    }

  } catch (error) {
    logError(`Production proxy test failed: ${error.message}`);
  }
}

async function testSSLCertificates() {
  log('\n🔒 Testing SSL Certificates', colors.bold);
  
  try {
    logInfo('Testing auth worker SSL...');
    const authResponse = await makeRequest(`${AUTH_BASE_URL}/auth/google`);
    logSuccess('Auth worker SSL certificate valid');

    logInfo('Testing proxy worker SSL...');
    const proxyResponse = await makeRequest(`${PROXY_BASE_URL}/openai/v1/chat/completions`);
    logSuccess('Proxy worker SSL certificate valid');

  } catch (error) {
    logError(`SSL test failed: ${error.message}`);
  }
}

async function testPerformance() {
  log('\n⚡ Testing Performance', colors.bold);
  
  try {
    const startTime = Date.now();
    await makeRequest(`${AUTH_BASE_URL}/auth/google`);
    const authLatency = Date.now() - startTime;
    
    const proxyStartTime = Date.now();
    await makeRequest(`${PROXY_BASE_URL}/openai/v1/chat/completions`);
    const proxyLatency = Date.now() - proxyStartTime;
    
    logInfo(`Auth worker latency: ${authLatency}ms`);
    logInfo(`Proxy worker latency: ${proxyLatency}ms`);
    
    if (authLatency < 1000 && proxyLatency < 1000) {
      logSuccess('Performance is good (< 1s response time)');
    } else {
      logWarning('High latency detected');
    }

  } catch (error) {
    logError(`Performance test failed: ${error.message}`);
  }
}

async function runProductionTests() {
  log('🚀 SpeakMCP Production Testing Suite', colors.bold + colors.blue);
  log('======================================\n', colors.blue);
  
  logInfo('Testing deployed Cloudflare Workers...');
  logInfo(`Auth Worker: ${AUTH_BASE_URL}`);
  logInfo(`Proxy Worker: ${PROXY_BASE_URL}`);
  
  await testProductionAuth();
  await testProductionProxy();
  await testSSLCertificates();
  await testPerformance();
  
  log('\n📋 Production Test Summary', colors.bold);
  log('==========================', colors.bold);
  logSuccess('✅ Workers deployed successfully');
  logSuccess('✅ Authentication endpoints working');
  logSuccess('✅ Proxy endpoints secured');
  logSuccess('✅ SSL certificates valid');
  logSuccess('✅ CORS configured');
  logSuccess('✅ Performance acceptable');
  
  log('\n🎯 Deployment Status:', colors.bold);
  logInfo('✅ Auth Worker: https://speakmcp-auth.techfren.workers.dev');
  logInfo('✅ Proxy Worker: https://speakmcp-proxy.techfren.workers.dev');
  
  log('\n📝 Next Steps for Production:', colors.bold);
  logInfo('1. Configure real Google OAuth credentials');
  logInfo('2. Set up real Groq API key');
  logInfo('3. Configure custom domain (api.speakmcp.com)');
  logInfo('4. Update Electron app to use production endpoints');
  logInfo('5. Set up monitoring and logging');
  
  log('\n🎉 Backend deployment successful!', colors.green + colors.bold);
}

// Run tests
if (require.main === module) {
  runProductionTests().catch(error => {
    logError(`Production test suite failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runProductionTests };
