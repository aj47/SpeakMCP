#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration for each server
const servers = [
  {
    name: 'Filesystem Server',
    path: path.join(__dirname, 'filesystem', 'index.js'),
    testMessage: '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
  },
  {
    name: 'Calculator Server', 
    path: path.join(__dirname, 'calculator', 'index.js'),
    testMessage: '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
  },
  {
    name: 'Database Server',
    path: path.join(__dirname, 'database', 'index.js'), 
    testMessage: '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
  },
  {
    name: 'Weather Server',
    path: path.join(__dirname, 'weather', 'index.js'),
    testMessage: '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
  },
  {
    name: 'Web Scraper Server',
    path: path.join(__dirname, 'webscraper', 'index.js'),
    testMessage: '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
  }
];

async function testServer(server) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Testing ${server.name}...`);
    
    const child = spawn('node', [server.path], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let responded = false;

    // Set timeout
    const timeout = setTimeout(() => {
      if (!responded) {
        child.kill();
        resolve({
          name: server.name,
          success: false,
          error: 'Timeout - server did not respond within 5 seconds'
        });
      }
    }, 5000);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Look for MCP response
      if (stdout.includes('"tools"') && !responded) {
        responded = true;
        clearTimeout(timeout);
        child.kill();
        resolve({
          name: server.name,
          success: true,
          message: 'Server responded with tools list'
        });
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      
      // Look for server startup message
      if (stderr.includes('running on stdio') && !responded) {
        // Send test message after server starts
        setTimeout(() => {
          child.stdin.write(server.testMessage + '\n');
        }, 100);
      }
    });

    child.on('error', (error) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        resolve({
          name: server.name,
          success: false,
          error: `Failed to start: ${error.message}`
        });
      }
    });

    child.on('exit', (code) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        
        if (code === 0) {
          resolve({
            name: server.name,
            success: true,
            message: 'Server started and exited cleanly'
          });
        } else {
          resolve({
            name: server.name,
            success: false,
            error: `Server exited with code ${code}. stderr: ${stderr}`
          });
        }
      }
    });
  });
}

async function runTests() {
  console.log('🚀 Starting MCP Server Tests\n');
  console.log('Testing each server to ensure they start correctly and respond to MCP requests...\n');

  const results = [];
  
  for (const server of servers) {
    const result = await testServer(server);
    results.push(result);
    
    if (result.success) {
      console.log(`✅ ${result.name}: ${result.message}`);
    } else {
      console.log(`❌ ${result.name}: ${result.error}`);
    }
  }

  // Summary
  console.log('\n📊 Test Summary:');
  console.log('================');
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => r.success === false).length;
  
  console.log(`✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);
  
  if (failed > 0) {
    console.log('\n🔍 Failed Tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   • ${r.name}: ${r.error}`);
    });
  }

  console.log('\n📝 Next Steps:');
  if (passed === results.length) {
    console.log('🎉 All servers are working correctly!');
    console.log('   • You can now configure them in SpeakMCP');
    console.log('   • Use the sample configurations in examples/sample-configs/');
    console.log('   • Check individual README files for usage instructions');
  } else {
    console.log('⚠️  Some servers failed to start:');
    console.log('   • Check that all dependencies are installed (npm install)');
    console.log('   • Verify Node.js version compatibility');
    console.log('   • Check individual server README files for requirements');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
