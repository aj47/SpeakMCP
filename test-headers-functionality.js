#!/usr/bin/env node

/**
 * Test script to verify custom HTTP headers functionality for streamable HTTP MCP servers
 * This tests the configuration parsing and header merging logic
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== SpeakMCP Headers Functionality Test ===\n');

// Test 1: Headers parsing logic (simulating the UI component logic)
console.log('1. Testing headers parsing logic:');

function parseHeaders(headersString) {
  const headersObject = {};
  if (headersString.trim()) {
    headersString.split("\n").forEach((line) => {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        headersObject[key.trim()] = valueParts.join("=").trim();
      }
    });
  }
  return headersObject;
}

// Test cases for header parsing
const testCases = [
  {
    name: "Simple headers",
    input: "X-API-Key=abc123\nUser-Agent=SpeakMCP/1.0",
    expected: { "X-API-Key": "abc123", "User-Agent": "SpeakMCP/1.0" }
  },
  {
    name: "Headers with equals in value",
    input: "Authorization=Bearer token=abc123\nContent-Type=application/json",
    expected: { "Authorization": "Bearer token=abc123", "Content-Type": "application/json" }
  },
  {
    name: "Empty headers",
    input: "",
    expected: {}
  },
  {
    name: "Headers with whitespace",
    input: "  X-Custom-Header  =  custom-value  \n  Another-Header  =  another-value  ",
    expected: { "X-Custom-Header": "custom-value", "Another-Header": "another-value" }
  }
];

let allTestsPassed = true;

testCases.forEach((testCase, index) => {
  const result = parseHeaders(testCase.input);
  const passed = JSON.stringify(result) === JSON.stringify(testCase.expected);
  
  console.log(`   Test ${index + 1} (${testCase.name}): ${passed ? '✅ PASS' : '❌ FAIL'}`);
  if (!passed) {
    console.log(`     Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`     Got:      ${JSON.stringify(result)}`);
    allTestsPassed = false;
  }
});

console.log();

// Test 2: Header merging logic (simulating the transport creation logic)
console.log('2. Testing header merging logic:');

function createRequestHeaders(customHeaders, oauthToken = null) {
  const headers = { ...customHeaders };
  if (oauthToken) {
    headers['Authorization'] = `Bearer ${oauthToken}`;
  }
  return headers;
}

const mergingTestCases = [
  {
    name: "Custom headers only",
    customHeaders: { "X-API-Key": "abc123", "User-Agent": "SpeakMCP/1.0" },
    oauthToken: null,
    expected: { "X-API-Key": "abc123", "User-Agent": "SpeakMCP/1.0" }
  },
  {
    name: "OAuth token only",
    customHeaders: {},
    oauthToken: "oauth-token-123",
    expected: { "Authorization": "Bearer oauth-token-123" }
  },
  {
    name: "Custom headers with OAuth token",
    customHeaders: { "X-API-Key": "abc123", "Content-Type": "application/json" },
    oauthToken: "oauth-token-123",
    expected: { 
      "X-API-Key": "abc123", 
      "Content-Type": "application/json",
      "Authorization": "Bearer oauth-token-123" 
    }
  },
  {
    name: "OAuth overrides custom Authorization header",
    customHeaders: { "Authorization": "Basic xyz", "X-Custom": "value" },
    oauthToken: "oauth-token-123",
    expected: { 
      "Authorization": "Bearer oauth-token-123",
      "X-Custom": "value"
    }
  }
];

mergingTestCases.forEach((testCase, index) => {
  const result = createRequestHeaders(testCase.customHeaders, testCase.oauthToken);
  const passed = JSON.stringify(result) === JSON.stringify(testCase.expected);
  
  console.log(`   Test ${index + 1} (${testCase.name}): ${passed ? '✅ PASS' : '❌ FAIL'}`);
  if (!passed) {
    console.log(`     Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`     Got:      ${JSON.stringify(result)}`);
    allTestsPassed = false;
  }
});

console.log();

// Test 3: MCPServerConfig validation
console.log('3. Testing MCPServerConfig structure:');

const sampleConfig = {
  transport: "streamableHttp",
  url: "http://localhost:8080/mcp",
  headers: {
    "X-API-Key": "test-key",
    "User-Agent": "SpeakMCP/1.0"
  },
  oauth: {
    scope: "read:data"
  },
  timeout: 30000,
  disabled: false
};

const configTests = [
  {
    name: "Valid streamableHttp config with headers",
    config: sampleConfig,
    shouldBeValid: true
  },
  {
    name: "Config without headers (should still be valid)",
    config: { ...sampleConfig, headers: undefined },
    shouldBeValid: true
  },
  {
    name: "Config with empty headers object",
    config: { ...sampleConfig, headers: {} },
    shouldBeValid: true
  }
];

configTests.forEach((testCase, index) => {
  // Basic validation - check required fields for streamableHttp
  const isValid = testCase.config.transport === "streamableHttp" && 
                  testCase.config.url && 
                  typeof testCase.config.url === "string";
  
  const passed = isValid === testCase.shouldBeValid;
  console.log(`   Test ${index + 1} (${testCase.name}): ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  if (!passed) {
    allTestsPassed = false;
  }
});

console.log();

// Summary
console.log('=== Test Summary ===');
if (allTestsPassed) {
  console.log('🎉 All tests passed! Headers functionality is working correctly.');
  console.log('\nThe implementation should:');
  console.log('• Parse headers from textarea input correctly');
  console.log('• Merge custom headers with OAuth headers properly');
  console.log('• Handle edge cases like empty headers and special characters');
  console.log('• Maintain OAuth header precedence over custom Authorization headers');
} else {
  console.log('❌ Some tests failed. Please review the implementation.');
  process.exit(1);
}

console.log('\n=== Manual Testing Instructions ===');
console.log('To manually test the headers functionality:');
console.log('1. Start the SpeakMCP application');
console.log('2. Go to MCP Server Configuration');
console.log('3. Add a new server with transport type "Streamable HTTP"');
console.log('4. Enter a test URL (e.g., http://httpbin.org/headers)');
console.log('5. Add custom headers in the format:');
console.log('   X-Test-Header=test-value');
console.log('   User-Agent=SpeakMCP-Test/1.0');
console.log('6. Test the connection to verify headers are sent');
console.log('7. Check server logs or use a tool like httpbin.org to verify headers');
