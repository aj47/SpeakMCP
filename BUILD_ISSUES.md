# Windows Build Issues

## Error: "Could not find the verknüpfung"

**Issue:** When running the Windows executable, the error "could not find the verknüpfung" (German for "shortcut") appears.

**Root Cause:** The application hasn't been properly built/compiled yet.

## Build Process Issues

### 1. TypeScript Configuration Errors

**Error:**
```
error TS2688: Cannot find type definition file for 'electron-vite/node'.
error TS6053: File '@electron-toolkit/tsconfig/tsconfig.node.json' not found.
```

**Cause:** Missing `@electron-toolkit/tsconfig` dependency.

### 2. npm install Failures

**Error:**
```
gyp ERR! configure error 
gyp ERR! stack Error: `gyp` failed with exit code: 1
/usr/bin/bash: Files\Git\bin\bash.exe: No such file or directory
```

**Cause:** 
- Native module compilation issues with `@egoist/electron-panel-window`
- Bash path resolution problems on Windows
- Missing or incorrectly configured build tools

### 3. pnpm Issues

**Error:**
```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined
```

**Cause:** The `scripts/fix-pnpm-windows.js` script has a bug with undefined path.

## Recommended Solutions

### Option 1: Fix Dependencies
1. Install missing TypeScript configuration package:
   ```bash
   npm install @electron-toolkit/tsconfig --save-dev
   ```

2. Fix the pnpm Windows script
3. Ensure proper build tools are installed (Visual Studio Build Tools)

### Option 2: Alternative Build Approach
1. Skip TypeScript checks temporarily:
   ```bash
   npx electron-vite build --skip-typecheck
   ```

2. Build Rust component separately:
   ```bash
   cd speakmcp-rs && cargo build --release
   ```

3. Use electron-builder directly:
   ```bash
   npx electron-builder --win --config electron-builder.config.cjs
   ```

### Option 3: Docker Build
Consider using a Docker container with all necessary build tools pre-installed to avoid Windows-specific build issues.

## Expected Output Location
After successful build, the Windows executable should be located in:
- `dist/speakmcp-0.1.7-setup.exe` (installer)
- `dist/win-unpacked/speakmcp.exe` (unpacked executable)