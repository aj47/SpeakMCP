# Apple Code Signing and Distribution Guide for SpeakMCP

This guide will help you set up code signing and notarization for distributing SpeakMCP on macOS using your Apple Developer account

## Prerequisites

1. **Apple Developer Account**: You should have an active Apple Developer Program membership
2. **macOS**: Code signing must be done on a Mac
3. **Xcode Command Line Tools**: Install with `xcode-select --install`

## Quick Setup

Run the automated setup script:

```bash
npm run setup:apple
```

This script will guide you through:
1. Getting your Apple Developer Team ID
2. Creating an App-Specific Password
3. Installing your Developer Certificate
4. Configuring your `.env` file

## Manual Setup

If you prefer to set up manually, follow these steps:

### Step 1: Get Your Apple Developer Team ID

1. Go to [Apple Developer Portal](https://developer.apple.com/account/)
2. Sign in with Your Email
3. Find your **Team ID** in the membership section (10-character string like `ABC123DEF4`)

### Step 2: Create App-Specific Password

1. Go to [Apple ID Account Management](https://appleid.apple.com/account/manage)
2. Sign in with Your Email
3. Navigate to **Sign-In and Security** > **App-Specific Passwords**
4. Click **+** to generate a new password
5. Label it "SpeakMCP Notarization"
6. Save the generated password (format: `xxxx-xxxx-xxxx-xxxx`)

### Step 3: Create and Install Developer Certificate

1. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)
2. Click **+** to create a new certificate
3. Select **Developer ID Application** (for distribution outside Mac App Store)
4. Create a Certificate Signing Request (CSR):
   - Open **Keychain Access** on your Mac
   - Go to **Keychain Access** > **Certificate Assistant** > **Request a Certificate From a Certificate Authority**
   - Enter your email and name, select "Saved to disk"
5. Upload the CSR and download the certificate
6. Double-click the downloaded certificate to install it in Keychain Access

### Step 4: Configure Environment Variables

Update your `.env` file with your credentials:

```bash
# Apple Developer credentials
APPLE_TEAM_ID=YOUR_TEAM_ID_HERE
APPLE_ID=YOUR_EMAIL
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
CSC_NAME="Developer ID Application: Your Name (YOUR_TEAM_ID)"
```

To find your exact signing identity name, run:
```bash
security find-identity -v -p codesigning
```

## Building and Signing

### Build Signed App

```bash
npm run build:mac:signed
```

This will:
1. Build the app
2. Sign it with your Developer ID certificate
3. Notarize it with Apple (if credentials are configured)
4. Create a signed DMG in the `dist/` folder

### Build Universal Binary

For both Intel and Apple Silicon Macs:

```bash
npm run build:mac:universal
```

### Build Options

- `npm run build:mac` - Basic build (may not be signed)
- `npm run build:mac:signed` - Build with signing and notarization
- `npm run build:mac:universal` - Universal binary for all Mac architectures

## Distribution

### Direct Distribution

1. Upload the signed DMG to your website or file hosting service
2. Users can download and install directly
3. The app will run without Gatekeeper warnings (if properly signed and notarized)

### GitHub Releases

The app is configured to publish to GitHub releases:

```bash
npm run release
```

This will create a GitHub release with the signed binaries.

## Troubleshooting

### Common Issues

**"No signing identity found"**
- Make sure your Developer ID certificate is installed in Keychain Access
- Verify the certificate is valid and not expired
- Check that `CSC_NAME` matches exactly what's shown in Keychain

**"Notarization failed"**
- Verify your App-Specific Password is correct
- Ensure your Apple ID has the necessary permissions
- Check that your Team ID is correct

**"App is damaged and can't be opened"**
- This usually means the app wasn't properly signed
- Try rebuilding with `npm run build:mac:signed`
- Verify all environment variables are set correctly

### Verification Commands

Check if your app is properly signed:
```bash
codesign -dv --verbose=4 dist/mac-arm64/SpeakMCP.app
```

Check notarization status:
```bash
spctl -a -vvv -t install dist/SpeakMCP-*.dmg
```

### Debug Mode

To see detailed signing information during build:
```bash
DEBUG=electron-builder npm run build:mac:signed
```

## Security Notes

- Never commit your `.env` file to version control
- Keep your App-Specific Password secure
- Regularly rotate your App-Specific Passwords
- Monitor your Apple Developer account for any unauthorized activity

## Support

If you encounter issues:
1. Check the [Electron Builder documentation](https://www.electron.build/code-signing)
2. Review Apple's [Notarization documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
3. Check the build logs for specific error messages
