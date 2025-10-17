#!/bin/bash
set -e

# Post-removal script for SpeakMCP Debian package
# This script cleans up desktop integration and symlinks

echo "Cleaning up SpeakMCP..."

BIN_NAME="speakmcp"
ICON_DIR="/usr/share/icons/hicolor"

# 1. Remove update-alternatives symlink
if command -v update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove $BIN_NAME /opt/SpeakMCP/$BIN_NAME 2>/dev/null || true
    echo "✓ Removed PATH symlink"
fi

# 2. Update icon cache after icon removal
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
    echo "✓ Updated icon cache"
fi

# 3. Update desktop database after .desktop file removal
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
    echo "✓ Updated desktop database"
fi

# 4. Update MIME database
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime 2>/dev/null || true
fi

echo "SpeakMCP has been removed."

exit 0

