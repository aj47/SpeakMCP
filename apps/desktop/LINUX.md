# Linux Installation Guide

SpeakMCP provides voice dictation and AI assistant capabilities for Linux users.

## Quick Start

### Option 1: Pre-built Packages (Recommended)

Download from [v0.2.2 Release](https://github.com/aj47/SpeakMCP/releases/tag/v0.2.2):

#### AppImage (Universal)

```bash
# Download
wget https://github.com/aj47/SpeakMCP/releases/download/v0.2.2/SpeakMCP-0.2.2-x64.AppImage

# Make executable
chmod +x SpeakMCP-0.2.2-x64.AppImage

# Run
./SpeakMCP-0.2.2-x64.AppImage
```

#### Debian/Ubuntu (.deb)

```bash
# Download
wget https://github.com/aj47/SpeakMCP/releases/download/v0.2.2/SpeakMCP-0.2.2-amd64.deb

# Install
sudo dpkg -i SpeakMCP-0.2.2-amd64.deb

# Install missing dependencies if needed
sudo apt-get install -f

# Run
speakmcp
```

### Option 2: Build from Source

Build the latest version with all features:

```bash
# Prerequisites
# - Node.js 18-20
# - pnpm (npm install -g pnpm)
# - Rust toolchain (https://rustup.rs)
# - Build essentials (gcc, make, etc.)

# Clone and build
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP
pnpm install
pnpm build-rs        # Build Rust keyboard/input binary
pnpm build:linux     # Build Linux packages

# Output packages in apps/desktop/dist/
```

### Option 3: Docker Build

For a reproducible build environment:

```bash
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP

# Build Linux packages using Docker
docker compose run --rm build-linux

# Output packages in ./dist/
```

## System Requirements

- **OS**: Ubuntu 20.04+, Debian 11+, Fedora 36+, or compatible
- **Architecture**: x64 (amd64)
- **Audio**: PulseAudio or PipeWire with PulseAudio compatibility
- **Display**: X11 or Wayland (with XWayland for some features)

### Dependencies

The .deb package will install these automatically:

- `libgtk-3-0` - GTK3 for UI
- `libnotify4` - Desktop notifications
- `libnss3` - Network security
- `libxss1` - Screen saver extension
- `libxtst6` - X test extension (for input simulation)
- `xdg-utils` - Desktop integration
- `libatspi2.0-0` - Accessibility
- `libuuid1` - UUID library
- `libsecret-1-0` - Secret storage

Recommended:
- `libappindicator3-1` - System tray support
- `pulseaudio` - Audio capture

## Feature Support

| Feature | Status | Notes |
|---------|--------|-------|
| Voice Dictation | ✅ Works | Hold Ctrl to record |
| Text-to-Speech | ✅ Works | Requires API key |
| Text Input Mode | ✅ Works | Ctrl+T |
| MCP Agent Mode | ⚠️ Partial | Keyboard simulation limited |
| System Tray | ✅ Works | Requires libappindicator |

## Troubleshooting

### No audio input

```bash
# Check PulseAudio is running
pulseaudio --check

# List audio sources
pactl list sources short

# Grant microphone permissions if using Flatpak/Snap
```

### Keyboard shortcuts not working

Some desktop environments require accessibility permissions:

```bash
# GNOME - enable accessibility
gsettings set org.gnome.desktop.interface toolkit-accessibility true

# For Wayland, run with XWayland or use native Wayland support
```

### AppImage won't start

```bash
# Install FUSE if missing
sudo apt install libfuse2

# Or extract and run
./SpeakMCP-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

## Getting Help

- [GitHub Issues](https://github.com/aj47/SpeakMCP/issues)
- [Discord Community](https://discord.gg/cK9WeQ7jPq)

