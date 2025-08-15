#!/usr/bin/env node

/**
 * Script to clear OAuth tokens for the Notion server
 * This will force a fresh OAuth authentication flow
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Get the data folder path (same as in config.ts)
const dataFolder = path.join(os.homedir(), '.speakmcp');
const oauthStorageFile = path.join(dataFolder, 'oauth-storage.json');

console.log('🧹 Clearing OAuth tokens for Notion server...');
console.log('📁 OAuth storage file:', oauthStorageFile);

try {
  if (!fs.existsSync(oauthStorageFile)) {
    console.log('ℹ️  No OAuth storage file found - nothing to clear');
    process.exit(0);
  }

  // Read the current storage
  const encryptedData = fs.readFileSync(oauthStorageFile, 'utf8');
  console.log('📖 Found OAuth storage file');

  // For now, just delete the entire file to clear all tokens
  // In a real implementation, we'd decrypt, modify, and re-encrypt
  fs.unlinkSync(oauthStorageFile);
  console.log('✅ OAuth storage file deleted - all tokens cleared');
  console.log('🔄 Next OAuth attempt will trigger fresh authentication');

} catch (error) {
  console.error('❌ Error clearing OAuth tokens:', error.message);
  process.exit(1);
}
