#!/usr/bin/env node

// Test script to verify debug flags are working
import { initDebugFlags, isDebugLLM, isDebugTools, logLLM, logTools } from './src/main/debug.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Debug Flag Test ===');

// Test with CLI args
const testArgs = ['--debug-llm', '--debug-tools'];
const flags = initDebugFlags(testArgs);

console.log('Debug flags initialized:', flags);
console.log('isDebugLLM():', isDebugLLM());
console.log('isDebugTools():', isDebugTools());

// Test logging
if (isDebugLLM()) {
  logLLM('Test LLM debug message - this should appear');
  logLLM('Test object:', { test: true, timestamp: new Date().toISOString() });
} else {
  console.log('Debug LLM is NOT enabled - check flags above');
}

if (isDebugTools()) {
  logTools('Test Tools debug message - this should appear');
  logTools('Test object:', { test: true, timestamp: new Date().toISOString() });
} else {
  console.log('Debug Tools is NOT enabled - check flags above');
}

// Test environment variables
console.log('Environment DEBUG:', process.env.DEBUG);
console.log('Environment DEBUG_LLM:', process.env.DEBUG_LLM);
console.log('Environment DEBUG_TOOLS:', process.env.DEBUG_TOOLS);

console.log('=== Test Complete ===');
