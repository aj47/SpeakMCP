#!/bin/bash
set -e

# Post-installation script for SpeakMCP Debian package
# This script sets up desktop integration, permissions, and PATH symlinks

echo "Setting up SpeakMCP..."

# Define installation paths
INSTALL_DIR="/opt/SpeakMCP"
BIN_NAME="speakmcp"
DESKTOP_FILE="/usr/share/applications/speakmcp.desktop"
ICON_DIR="/usr/share/icons/hicolor"

# 1. Make binary executable
if [ -f "$INSTALL_DIR/$BIN_NAME" ]; then
    chmod +x "$INSTALL_DIR/$BIN_NAME"
    echo "✓ Made binary executable"
fi

# 2. Set chrome-sandbox permissions for Electron security
# This is required for Electron apps to run properly
if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
    chmod 4755 "$INSTALL_DIR/chrome-sandbox"
    echo "✓ Set chrome-sandbox permissions"
fi

# 3. Create symlink in /usr/bin for PATH access
# Use update-alternatives to manage the symlink properly
if [ -f "$INSTALL_DIR/$BIN_NAME" ]; then
    update-alternatives --install \
        /usr/bin/$BIN_NAME \
        $BIN_NAME \
        "$INSTALL_DIR/$BIN_NAME" \
        100
    echo "✓ Created PATH symlink"
fi

# 4. Install desktop file (electron-builder should handle this, but ensure it's there)
# The desktop file should already be installed by electron-builder
if [ -f "$DESKTOP_FILE" ]; then
    chmod 644 "$DESKTOP_FILE"
    echo "✓ Desktop file installed"
fi

# 5. Update icon cache
# This ensures the app icon appears in menus and launchers
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
    echo "✓ Updated icon cache"
fi

# 6. Update desktop database
# This ensures the .desktop file is recognized by desktop environments
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
    echo "✓ Updated desktop database"
fi

# 7. Update MIME database (if needed in the future)
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime 2>/dev/null || true
fi

echo "SpeakMCP installation complete!"
echo ""
echo "You can now:"
echo "  • Launch SpeakMCP from your application menu"
echo "  • Run 'speakmcp' from the terminal"
echo ""

exit 0

