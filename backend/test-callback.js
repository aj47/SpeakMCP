#!/usr/bin/env node

// Test OAuth callback with a fake authorization code
// This will help us debug the callback flow

const testCode = 'test-auth-code-123';
const callbackUrl = `http://localhost:8787/auth/callback?code=${testCode}`;

console.log('Testing OAuth callback...');
console.log('URL:', callbackUrl);

fetch(callbackUrl)
  .then(response => {
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));
    return response.text();
  })
  .then(body => {
    console.log('Response body:', body);
  })
  .catch(error => {
    console.error('Error:', error);
  });
