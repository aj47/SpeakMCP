# Windows Defender Setup for SpeakMCP

This guide helps you configure Windows Defender to work optimally with SpeakMCP and avoid false positive detections.

## Why Windows Defender May Flag SpeakMCP

Windows Defender and other antivirus software may flag SpeakMCP for several reasons:

1. **Unsigned Binaries**: Development builds are not code-signed, which triggers security warnings
2. **Keyboard/Mouse Automation**: SpeakMCP uses input simulation for text insertion
3. **Microphone Access**: Continuous audio monitoring can appear suspicious
4. **Network Activity**: AI API calls and MCP server communication
5. **Binary Execution**: The Rust binary (`speakmcp-rs.exe`) performs low-level system operations

## Recommended Windows Defender Exclusions

### For Users

Add these exclusions in Windows Defender to prevent interference:

1. **Open Windows Security**
   - Press `Win + I` → Update & Security → Windows Security
   - Click "Virus & threat protection"

2. **Add Exclusions**
   - Click "Manage settings" under "Virus & threat protection settings"
   - Click "Add or remove exclusions"
   - Add the following exclusions:

#### File/Folder Exclusions:
```
C:\Users\[YourUsername]\AppData\Local\Programs\SpeakMCP\
C:\Users\[YourUsername]\AppData\Roaming\SpeakMCP\
C:\Program Files\SpeakMCP\
```

#### Process Exclusions:
```
speakmcp.exe
speakmcp-rs.exe
```

#### File Type Exclusions (Optional):
```
.speakmcp
```

### For Developers

Additional exclusions for development:

#### Development Folders:
```
[Your-Project-Path]\SpeakMCP\
[Your-Project-Path]\SpeakMCP\dist\
[Your-Project-Path]\SpeakMCP\out\
[Your-Project-Path]\SpeakMCP\resources\bin\
[Your-Project-Path]\SpeakMCP\speakmcp-rs\target\
```

#### Build Processes:
```
cargo.exe
electron.exe
electron-builder.exe
```

## PowerShell Script for Automatic Exclusions

Run this PowerShell script as Administrator to add exclusions automatically:

```powershell
# Add Windows Defender exclusions for SpeakMCP
# Run as Administrator

Write-Host "Adding Windows Defender exclusions for SpeakMCP..." -ForegroundColor Green

# Get current user path
$userPath = $env:USERPROFILE

# Add folder exclusions
$folders = @(
    "$userPath\AppData\Local\Programs\SpeakMCP",
    "$userPath\AppData\Roaming\SpeakMCP",
    "C:\Program Files\SpeakMCP"
)

foreach ($folder in $folders) {
    try {
        Add-MpPreference -ExclusionPath $folder
        Write-Host "✓ Added folder exclusion: $folder" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to add folder exclusion: $folder" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Add process exclusions
$processes = @(
    "speakmcp.exe",
    "speakmcp-rs.exe"
)

foreach ($process in $processes) {
    try {
        Add-MpPreference -ExclusionProcess $process
        Write-Host "✓ Added process exclusion: $process" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to add process exclusion: $process" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "Windows Defender exclusions setup complete!" -ForegroundColor Green
Write-Host "You may need to restart SpeakMCP for changes to take effect." -ForegroundColor Yellow
```

## Code Signing Information

### For Official Releases

Official SpeakMCP releases are code-signed with a valid certificate to establish trust with Windows Defender.

### For Development Builds

Development builds are not code-signed. To enable code signing for your builds:

1. **Obtain a Code Signing Certificate**
   - Purchase from a trusted CA (DigiCert, Sectigo, etc.)
   - Or use a self-signed certificate for testing

2. **Configure Environment Variables**
   ```bash
   # For .p12/.pfx certificate files
   export CSC_LINK="path/to/certificate.p12"
   export CSC_KEY_PASSWORD="certificate_password"
   
   # For Windows-specific certificate
   export WIN_CSC_LINK="path/to/certificate.p12"
   export WIN_CSC_KEY_PASSWORD="certificate_password"
   
   # Publisher name
   export WIN_PUBLISHER_NAME="Your Company Name"
   ```

3. **Build with Code Signing**
   ```bash
   npm run build:win
   ```

## Troubleshooting

### SpeakMCP Still Being Blocked

1. **Check Real-time Protection**: Temporarily disable real-time protection to test
2. **Submit False Positive**: Report to Microsoft if you believe it's a false positive
3. **Use Alternative Antivirus**: Some users prefer Windows Defender alternatives

### Performance Issues

1. **Add More Exclusions**: Include temporary directories and build folders
2. **Disable Cloud Protection**: May reduce scanning overhead
3. **Adjust Scanning Schedule**: Avoid active scanning during SpeakMCP usage

### Build Issues

1. **Run as Administrator**: Required for some build operations
2. **Disable Antivirus Temporarily**: During build process only
3. **Use Clean Build Script**: `npm run build:win:clean`

## Security Considerations

While exclusions improve performance, they also reduce security scanning. Only add exclusions for:

- ✅ Trusted installation directories
- ✅ Known SpeakMCP processes
- ✅ Development folders you control

Avoid broad exclusions like:
- ❌ Entire drives (C:\)
- ❌ System directories
- ❌ Unknown processes

## Support

If you continue experiencing issues:

1. Check the [GitHub Issues](https://github.com/aj47/SpeakMCP/issues)
2. Review [Windows Build Setup](WINDOWS_BUILD_SETUP.md)
3. Create a new issue with your Windows Defender logs
