#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMacOS = platform === 'darwin';
const isLinux = platform === 'linux';

console.log(`🔧 Building Rust binary for ${platform}...`);

// Create resources/bin directory
const resourcesBinDir = path.join(process.cwd(), 'resources', 'bin');
if (!fs.existsSync(resourcesBinDir)) {
    fs.mkdirSync(resourcesBinDir, { recursive: true });
    console.log('📁 Created resources/bin directory');
}

// Check if Rust is installed
function checkRustInstallation() {
    try {
        execSync('cargo --version', { stdio: 'pipe' });
        return true;
    } catch (error) {
        return false;
    }
}

if (!checkRustInstallation()) {
    console.error('❌ Cargo not found. Please install Rust from https://rustup.rs/');
    console.error('   After installation, restart your terminal and try again.');
    process.exit(1);
}

// Change to Rust project directory
const rustProjectDir = path.join(process.cwd(), 'speakmcp-rs');
if (!fs.existsSync(rustProjectDir)) {
    console.error('❌ Rust project directory not found: speakmcp-rs');
    process.exit(1);
}

console.log('🦀 Building Rust project...');

try {
    // Build the Rust project
    execSync('cargo build --release', { 
        cwd: rustProjectDir, 
        stdio: 'inherit' 
    });
    
    // Determine source and destination paths based on platform
    let sourcePath, destPath, binaryName;
    
    if (isWindows) {
        binaryName = 'speakmcp-rs.exe';
        sourcePath = path.join(rustProjectDir, 'target', 'release', binaryName);
        destPath = path.join(resourcesBinDir, binaryName);
    } else {
        binaryName = 'speakmcp-rs';
        sourcePath = path.join(rustProjectDir, 'target', 'release', binaryName);
        destPath = path.join(resourcesBinDir, binaryName);
    }
    
    // Check if the built binary exists
    if (!fs.existsSync(sourcePath)) {
        console.error(`❌ Built binary not found at: ${sourcePath}`);
        process.exit(1);
    }
    
    // Copy the binary to resources/bin
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✅ Binary copied to: ${destPath}`);
    
    // Make executable on Unix-like systems
    if (!isWindows) {
        fs.chmodSync(destPath, 0o755);
        console.log('🔐 Made binary executable');
    }
    
    // Sign the binary on macOS
    if (isMacOS) {
        console.log('🔐 Signing Rust binary...');
        try {
            execSync('./scripts/sign-binary.sh', { 
                cwd: process.cwd(), 
                stdio: 'inherit' 
            });
        } catch (error) {
            console.warn('⚠️  Binary signing failed, but build completed');
        }
    }
    
    console.log(`✅ ${platform} binary built successfully!`);
    
} catch (error) {
    console.error('❌ Failed to build Rust project:', error.message);
    process.exit(1);
}
