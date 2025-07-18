# Mac App Store Setup Guide for SpeakMCP

## Current Status
✅ Developer ID certificate installed  
❌ Mac App Store certificates needed  
❌ Bundle ID needs registration  
❌ Provisioning profile needed  
❌ App Store Connect app record needed  

## Step 1: Create Mac App Store Certificates

### 1.1 Create Certificate Signing Request (CSR)
1. Open **Keychain Access** on your Mac
2. Go to **Keychain Access** > **Certificate Assistant** > **Request a Certificate From a Certificate Authority**
3. Enter:
   - User Email: `arash@appricot.io`
   - Common Name: `Arash Joobandi`
   - CA Email: Leave blank
   - Request is: **Saved to disk**
4. Save as `SpeakMCP_MAS.certSigningRequest`

### 1.2 Create 3rd Party Mac Developer Application Certificate
1. Go to [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates/list)
2. Click **+** to create new certificate
3. Select **3rd Party Mac Developer Application**
4. Upload your CSR file
5. Download and install the certificate

### 1.3 Create 3rd Party Mac Developer Installer Certificate
1. Click **+** again for another certificate
2. Select **3rd Party Mac Developer Installer**
3. Upload the same CSR file
4. Download and install the certificate

## Step 2: Register Bundle ID

1. Go to [Apple Developer Identifiers](https://developer.apple.com/account/resources/identifiers/list)
2. Click **+** to create new identifier
3. Select **App IDs** and continue
4. Choose **App** and continue
5. Fill in:
   - **Description**: `SpeakMCP`
   - **Bundle ID**: `app.speakmcp` (Explicit)
6. **Capabilities**: Enable these:
   - ✅ Microphone
   - ✅ Network Extensions (if needed for API calls)
   - ✅ User Selected Files (for file access)
7. Click **Continue** and **Register**

## Step 3: Create Provisioning Profile

1. Go to [Provisioning Profiles](https://developer.apple.com/account/resources/profiles/list)
2. Click **+** to create new profile
3. Select **Mac App Store** and continue
4. Select your `app.speakmcp` Bundle ID
5. Select your **3rd Party Mac Developer Application** certificate
6. Name it: `SpeakMCP Mac App Store`
7. Download the profile and save it as `SpeakMCP_MAS.provisionprofile`

## Step 4: Install Provisioning Profile

```bash
# Create profiles directory if it doesn't exist
mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles

# Copy the downloaded profile
cp ~/Downloads/SpeakMCP_MAS.provisionprofile ~/Library/MobileDevice/Provisioning\ Profiles/
```

## Step 5: Update Environment Variables

Add to your `.env` file:
```bash
# Mac App Store Provisioning Profile
MAS_PROVISIONING_PROFILE="~/Library/MobileDevice/Provisioning Profiles/SpeakMCP_MAS.provisionprofile"
```

## Step 6: Create App Store Connect App Record

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click **My Apps**
3. Click **+** and select **New App**
4. Fill in:
   - **Platform**: macOS
   - **Name**: SpeakMCP
   - **Primary Language**: English (US)
   - **Bundle ID**: Select `app.speakmcp`
   - **SKU**: `speakmcp-2024`
5. Click **Create**

## Step 7: Configure App Information

In App Store Connect, fill out:

### App Information
- **Category**: Productivity
- **Subcategory**: (optional)
- **Content Rights**: Check if you own all rights

### Pricing and Availability
- **Price**: Free or set your price
- **Availability**: All territories or select specific ones

### App Privacy
- **Privacy Policy URL**: Required for App Store
- **Data Collection**: Declare what data you collect

## Step 8: Verify Setup

Run the verification script:
```bash
./scripts/check-mas-setup.sh
```

## Step 9: Build for Mac App Store

Once everything is set up:
```bash
npm run build:mas
```

This will create a `.pkg` file in the `dist/` directory.

## Step 10: Upload to App Store Connect

### Option A: Using Transporter App
1. Download **Transporter** from Mac App Store
2. Open Transporter
3. Sign in with your Apple ID
4. Drag and drop your `.pkg` file
5. Click **Deliver**

### Option B: Using Command Line
```bash
xcrun altool --upload-app --type osx --file "dist/SpeakMCP-0.0.2-mas.pkg" --username "arash@appricot.io" --password "brhx-mevz-kvxh-picy"
```

## Troubleshooting

### Common Issues:

**"No identity found"**
- Make sure both MAS certificates are installed in Keychain
- Check certificate names match your .env file

**"Provisioning profile not found"**
- Verify profile is in `~/Library/MobileDevice/Provisioning Profiles/`
- Check the profile path in .env file

**"Bundle ID mismatch"**
- Ensure Bundle ID in Apple Developer matches electron-builder config

**"Upload failed"**
- Check app record exists in App Store Connect
- Verify Bundle ID matches exactly
- Ensure version number is higher than any previous uploads

## Next Steps After Upload

1. **Processing**: Apple will process your upload (can take several minutes)
2. **TestFlight**: Your build will appear in TestFlight for internal testing
3. **App Review**: Submit for review when ready
4. **Metadata**: Add screenshots, description, keywords
5. **Release**: Choose manual or automatic release after approval

## Important Notes

- Mac App Store apps have stricter sandboxing requirements
- Some Electron features may not work in sandboxed environment
- Test thoroughly before submitting for review
- Apple review process typically takes 1-7 days
