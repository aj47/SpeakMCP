#!/bin/bash

echo "🔐 Creating Certificate Signing Request for Mac App Store"
echo "========================================================"

# Create a temporary config file for the CSR
cat > /tmp/csr.conf << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = California
L = San Francisco
O = Arash Joobandi
OU = Development
CN = Arash Joobandi
emailAddress = arash@appricot.io

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
EOF

# Generate private key and CSR
echo "Generating private key and CSR..."
openssl req -new -newkey rsa:2048 -nodes -keyout ~/Desktop/SpeakMCP_MAS.key -out ~/Desktop/SpeakMCP_MAS.csr -config /tmp/csr.conf

if [ $? -eq 0 ]; then
    echo "✅ CSR created successfully!"
    echo ""
    echo "Files created on your Desktop:"
    echo "  📄 SpeakMCP_MAS.csr - Upload this to Apple Developer Portal"
    echo "  🔑 SpeakMCP_MAS.key - Keep this private key safe"
    echo ""
    echo "Next steps:"
    echo "1. Go to: https://developer.apple.com/account/resources/certificates/list"
    echo "2. Click '+' to create new certificate"
    echo "3. Select '3rd Party Mac Developer Application'"
    echo "4. Upload the SpeakMCP_MAS.csr file"
    echo "5. Download and install the certificate"
    echo "6. Repeat for '3rd Party Mac Developer Installer' certificate"
else
    echo "❌ Failed to create CSR"
fi

# Clean up
rm -f /tmp/csr.conf
