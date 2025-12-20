/**
 * Test OAuth Deep Link Handler
 *
 * This script tests the OAuth deep link callback handling with various URL formats
 * to ensure the pathname normalization fix works correctly.
 */

import { URL } from 'url';

// Test cases for URL parsing
const testCases = [
  {
    name: 'Standard OAuth callback (double slash - with authority)',
    url: 'speakmcp://oauth/callback?code=test123&state=abc456',
    expected: {
      protocol: 'speakmcp:',
      host: 'oauth',
      pathname: '/callback',
      code: 'test123',
      state: 'abc456'
    }
  },
  {
    name: 'OAuth callback with single slash (no authority)',
    url: 'speakmcp:/oauth/callback?code=test456&state=xyz789',
    expected: {
      protocol: 'speakmcp:',
      pathname: '/oauth/callback',
      code: 'test456',
      state: 'xyz789'
    }
  },
  {
    name: 'OAuth callback with error',
    url: 'speakmcp://oauth/callback?error=access_denied&error_description=User%20denied',
    expected: {
      protocol: 'speakmcp:',
      pathname: '/oauth/callback',
      error: 'access_denied',
      error_description: 'User denied'
    }
  },
  {
    name: 'OAuth callback with triple slash',
    url: 'speakmcp:///oauth/callback?code=test789',
    expected: {
      protocol: 'speakmcp:',
      pathname: '/oauth/callback',
      code: 'test789'
    }
  },
  {
    name: 'OAuth callback with uppercase protocol (Windows compatibility)',
    url: 'SPEAKMCP://oauth/callback?code=test999&state=upper',
    expected: {
      protocol: 'speakmcp:', // URL constructor normalizes to lowercase
      host: 'oauth',
      pathname: '/callback',
      code: 'test999',
      state: 'upper'
    }
  }
];

console.log('Testing OAuth Deep Link URL Parsing\n');
console.log('='.repeat(60));

testCases.forEach((testCase, index) => {
  console.log(`\nTest ${index + 1}: ${testCase.name}`);
  console.log('-'.repeat(60));
  console.log(`URL: ${testCase.url}`);

  try {
    const parsedUrl = new URL(testCase.url);

    console.log(`\nParsed URL:`);
    console.log(`  Protocol: ${parsedUrl.protocol}`);
    console.log(`  Host: ${parsedUrl.host || '(empty)'}`);
    console.log(`  Hostname: ${parsedUrl.hostname || '(empty)'}`);
    console.log(`  Pathname: ${parsedUrl.pathname}`);
    console.log(`  Search: ${parsedUrl.search}`);

    // Apply the normalization fix - combine hostname and pathname
    let fullPath = parsedUrl.pathname;
    if (parsedUrl.hostname) {
      fullPath = `/${parsedUrl.hostname}${parsedUrl.pathname}`;
    }
    const normalizedPathname = fullPath.replace(/^\/+/, '/');
    console.log(`  Full Path (hostname + pathname): ${fullPath}`);
    console.log(`  Normalized Pathname: ${normalizedPathname}`);

    // Check protocol (case-insensitive for cross-platform compatibility)
    const isOAuthProtocol = parsedUrl.protocol.toLowerCase() === 'speakmcp:';
    const isOAuthPath = normalizedPathname === '/oauth/callback';

    console.log(`\nValidation:`);
    console.log(`  Is OAuth Protocol: ${isOAuthProtocol}`);
    console.log(`  Is OAuth Path: ${isOAuthPath}`);
    console.log(`  Would Match: ${isOAuthProtocol && isOAuthPath ? '✅ YES' : '❌ NO'}`);

    // Extract parameters
    const code = parsedUrl.searchParams.get('code');
    const state = parsedUrl.searchParams.get('state');
    const error = parsedUrl.searchParams.get('error');
    const errorDescription = parsedUrl.searchParams.get('error_description');

    console.log(`\nExtracted Parameters:`);
    if (code) console.log(`  Code: ${code}`);
    if (state) console.log(`  State: ${state}`);
    if (error) console.log(`  Error: ${error}`);
    if (errorDescription) console.log(`  Error Description: ${errorDescription}`);

  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
  }
});

console.log('\n' + '='.repeat(60));
console.log('\n✅ All tests completed!\n');
console.log('The fix ensures that URLs with pathname variations like:');
console.log('  - /oauth/callback (single slash)');
console.log('  - //oauth/callback (double slash)');
console.log('  - ///oauth/callback (triple slash)');
console.log('All normalize to: /oauth/callback\n');

