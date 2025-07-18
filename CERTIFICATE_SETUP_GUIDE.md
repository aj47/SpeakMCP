# Mac App Store Certificate Setup Guide

## Issue: Certificate Not Properly Linked

The certificate was downloaded but isn't properly linked to the private key. Let's fix this using the Apple-recommended method.

## Step 1: Clean Up Current Attempt

1. **Delete the existing certificate from Keychain**:
   - Open **Keychain Access** (already open)
   - Search for "Mac App Distribution" or "Arash Joobandi"
   - Delete any certificates that aren't working properly

2. **Clean up Desktop files**:
   ```bash
   rm ~/Desktop/mac_app.cer
   rm ~/Desktop/SpeakMCP_MAS.key
   rm ~/Desktop/SpeakMCP_MAS.csr
   rm ~/Desktop/SpeakMCP_MAS.p12
   ```

## Step 2: Create CSR Using Keychain Access (Recommended)

1. **Open Keychain Access**
2. **Go to Keychain Access menu** → **Certificate Assistant** → **Request a Certificate From a Certificate Authority**
3. **Fill in the form**:
   - **User Email Address**: `arash@appricot.io`
   - **Common Name**: `Arash Joobandi`
   - **CA Email Address**: Leave blank
   - **Request is**: Select **"Saved to disk"**
   - **Let me specify key pair information**: Check this box
4. **Click Continue**
5. **Key Pair Information**:
   - **Key Size**: 2048 bits
   - **Algorithm**: RSA
6. **Save as**: `SpeakMCP_MAS_Keychain.certSigningRequest` on Desktop
7. **Click Continue**

## Step 3: Create Mac App Distribution Certificate

1. **Go to Apple Developer Portal**: https://developer.apple.com/account/resources/certificates/list
2. **Click "+" to create new certificate**
3. **Select "Mac App Distribution"**
4. **Upload the new CSR**: `SpeakMCP_MAS_Keychain.certSigningRequest`
5. **Download the certificate** (save as `mac_app_keychain.cer`)
6. **Double-click the downloaded certificate** - it should automatically install and link to the private key

## Step 4: Create Mac Installer Distribution Certificate

1. **Click "+" again in Apple Developer Portal**
2. **Select "Mac Installer Distribution"**
3. **Upload the SAME CSR**: `SpeakMCP_MAS_Keychain.certSigningRequest`
4. **Download the certificate** (save as `mac_installer_keychain.cer`)
5. **Double-click the downloaded certificate** to install

## Step 5: Verify Installation

Run this command to check:
```bash
npm run check:mas
```

You should see:
```
Mac App Distribution: ✅ Found
Mac Installer Distribution: ✅ Found
```

## Why This Method Works Better

- **Keychain Access** creates the private key and CSR together
- **Private key stays in Keychain** and is automatically linked
- **Certificate installation** automatically finds the matching private key
- **No manual key management** required

## Alternative: Use Existing CSR But Import Properly

If you want to use the existing CSR, you need to:

1. **Import the private key first**:
   ```bash
   security import ~/Desktop/SpeakMCP_MAS.key -k ~/Library/Keychains/login.keychain
   ```

2. **Then import the certificate**:
   ```bash
   security import ~/Desktop/mac_app.cer -k ~/Library/Keychains/login.keychain
   ```

But the Keychain Access method is more reliable.

## Next Steps After Certificates

Once both certificates are properly installed:

1. **Create Bundle ID** at Apple Developer Portal
2. **Create Provisioning Profile**
3. **Create App Store Connect App Record**
4. **Build and upload your app**

Let me know when the certificates are properly installed and we'll continue with the next steps!
