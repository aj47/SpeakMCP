# 🌐 Cross-Platform Support and Linux Compatibility

**Status:** Proposed
**Priority:** Medium
**Labels:** enhancement, cross-platform, linux, compatibility

## Overview

Expand SpeakMCP's platform support to include Linux distributions and improve cross-platform compatibility across macOS, Windows, and Linux.

## Current Platform Support

### Supported Platforms
- ✅ **macOS (Apple Silicon)** - Full support with Lightning Whisper MLX
- ✅ **Windows x64** - Full support with cloud providers
- ❌ **Linux** - Not currently supported
- ❌ **macOS (Intel)** - Limited support (no Lightning Whisper MLX)

### Platform-Specific Features

#### macOS
- Lightning Whisper MLX local transcription
- Accessibility API integration
- System tray integration
- Keyboard event monitoring

#### Windows
- Accessibility API integration
- System tray integration
- Keyboard event monitoring
- Text injection via Windows API

## Linux Support Requirements

### 1. Core Functionality

#### System Integration
- [ ] X11/Wayland keyboard event monitoring
- [ ] Text injection via accessibility APIs
- [ ] System tray integration (various desktop environments)
- [ ] Audio capture and playback

#### Desktop Environment Support
- [ ] GNOME integration
- [ ] KDE Plasma integration
- [ ] XFCE compatibility
- [ ] Unity desktop support
- [ ] Generic X11/Wayland fallback

### 2. Distribution Support

#### Primary Targets
- [ ] Ubuntu LTS (20.04, 22.04, 24.04)
- [ ] Debian Stable
- [ ] Fedora (latest)
- [ ] Arch Linux
- [ ] openSUSE

#### Package Formats
- [ ] AppImage (universal)
- [ ] Snap package
- [ ] Flatpak
- [ ] .deb packages (Debian/Ubuntu)
- [ ] .rpm packages (Fedora/SUSE)

### 3. Technical Challenges

#### Rust Binary Adaptations
```rust
// Platform-specific keyboard handling
#[cfg(target_os = "linux")]
mod linux_keyboard {
    use x11::xlib::*;
    use std::ptr;

    pub fn listen_keyboard_events() -> Result<(), Box<dyn std::error::Error>> {
        // X11/Wayland keyboard monitoring implementation
    }

    pub fn inject_text(text: &str) -> Result<(), Box<dyn std::error::Error>> {
        // Linux text injection implementation
    }
}
```

#### Audio System Integration
- [ ] PulseAudio support
- [ ] ALSA integration
- [ ] PipeWire compatibility
- [ ] Jack audio system support

#### Permission Management
- [ ] Accessibility permissions (AT-SPI)
- [ ] Audio device permissions
- [ ] X11 security extensions
- [ ] Wayland security protocols

## Cross-Platform Improvements

### 1. Unified Architecture

#### Platform Abstraction Layer
```typescript
interface PlatformAPI {
  keyboard: KeyboardAPI
  audio: AudioAPI
  accessibility: AccessibilityAPI
  system: SystemAPI
}

class PlatformManager {
  static create(): PlatformAPI {
    switch (process.platform) {
      case 'darwin': return new MacOSPlatform()
      case 'win32': return new WindowsPlatform()
      case 'linux': return new LinuxPlatform()
      default: throw new Error('Unsupported platform')
    }
  }
}
```

#### Configuration Management
```typescript
interface PlatformConfig {
  shortcuts: Record<string, string>
  audioDevices: AudioDevice[]
  accessibilityFeatures: AccessibilityFeature[]
  systemIntegration: SystemIntegrationOptions
}
```

### 2. Feature Parity

#### Core Features (All Platforms)
- [ ] Voice recording and transcription
- [ ] Cloud provider integration (OpenAI, Groq, Gemini)
- [ ] Text post-processing
- [ ] Configuration management
- [ ] Recording history

#### Platform-Specific Features
- [ ] Local transcription (macOS Silicon only)
- [ ] Native system integration
- [ ] Platform-appropriate UI patterns
- [ ] OS-specific optimizations

### 3. Build System Enhancements

#### Electron Builder Configuration
```javascript
// electron-builder.config.cjs
module.exports = {
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'snap', arch: ['x64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
      { target: 'rpm', arch: ['x64', 'arm64'] }
    ],
    category: 'Utility',
    desktop: {
      Name: 'SpeakMCP',
      Comment: 'AI-powered dictation tool with MCP integration',
      Categories: 'Utility;AudioVideo;'
    }
  }
}
```

#### Cross-Compilation Setup
```bash
# Build for all platforms
pnpm build:all

# Platform-specific builds
pnpm build:linux-x64
pnpm build:linux-arm64
pnpm build:macos-intel
pnpm build:windows-arm64
```

## Linux-Specific Implementation

### 1. Keyboard Monitoring

#### X11 Implementation
```rust
use x11::xlib::*;
use x11::keysym::*;

pub struct X11KeyboardMonitor {
    display: *mut Display,
}

impl X11KeyboardMonitor {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        unsafe {
            let display = XOpenDisplay(std::ptr::null());
            if display.is_null() {
                return Err("Failed to open X11 display".into());
            }
            Ok(Self { display })
        }
    }

    pub fn listen(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Implement X11 keyboard event listening
    }
}
```

#### Wayland Implementation
```rust
use wayland_client::*;

pub struct WaylandKeyboardMonitor {
    // Wayland-specific implementation
}
```

### 2. Text Injection

#### AT-SPI Integration
```rust
use atspi::*;

pub fn inject_text_atspi(text: &str) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::new()?;
    let registry = Registry::new(&connection)?;

    // Find focused application and inject text
    Ok(())
}
```

### 3. System Tray

#### Multiple Backend Support
```typescript
class LinuxSystemTray {
  private backend: 'gtk' | 'qt' | 'ayatana' | 'generic'

  constructor() {
    this.backend = this.detectBackend()
  }

  private detectBackend(): 'gtk' | 'qt' | 'ayatana' | 'generic' {
    // Detect available system tray backend
  }
}
```

## Testing Strategy

### 1. Platform Testing Matrix

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Recording | ✅ | ✅ | 🧪 |
| Transcription | ✅ | ✅ | 🧪 |
| Text Injection | ✅ | ✅ | 🧪 |
| System Tray | ✅ | ✅ | 🧪 |
| Shortcuts | ✅ | ✅ | 🧪 |

### 2. Virtual Machine Testing
- [ ] Ubuntu 22.04 LTS VM
- [ ] Fedora 39 VM
- [ ] Debian 12 VM
- [ ] Arch Linux VM

### 3. Container Testing
```dockerfile
# Dockerfile for Linux testing
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    nodejs npm \
    libasound2-dev \
    libx11-dev \
    libxtst-dev \
    libatspi2.0-dev

COPY . /app
WORKDIR /app
RUN npm install && npm run build:linux
```

## Implementation Plan

### Phase 1: Foundation
- [ ] Platform abstraction layer design
- [ ] Basic Linux keyboard monitoring
- [ ] Cross-platform build system
- [ ] Linux VM testing environment

### Phase 2: Core Features
- [ ] Linux text injection implementation
- [ ] Audio system integration
- [ ] System tray implementation
- [ ] Basic UI functionality

### Phase 3: Polish & Distribution
- [ ] Package creation (AppImage, Snap, etc.)
- [ ] Desktop environment integration
- [ ] Permission handling
- [ ] Documentation and guides

### Phase 4: Optimization
- [ ] Performance optimization for Linux
- [ ] Memory usage optimization
- [ ] Battery life improvements
- [ ] Accessibility enhancements

## Distribution Strategy

### 1. Package Repositories
- [ ] Snap Store publication
- [ ] Flathub submission
- [ ] AUR package (Arch Linux)
- [ ] Ubuntu PPA
- [ ] Fedora COPR

### 2. Installation Methods
```bash
# Snap
sudo snap install speakmcp

# Flatpak
flatpak install flathub app.speakmcp.SpeakMCP

# AppImage
wget https://github.com/aj47/SpeakMCP/releases/latest/download/SpeakMCP-x86_64.AppImage
chmod +x SpeakMCP-x86_64.AppImage
./SpeakMCP-x86_64.AppImage

# Debian/Ubuntu
wget https://github.com/aj47/SpeakMCP/releases/latest/download/speakmcp_amd64.deb
sudo dpkg -i speakmcp_amd64.deb
```

## Documentation Requirements

### 1. Platform-Specific Guides
- [ ] Linux installation guide
- [ ] Permission setup instructions
- [ ] Troubleshooting for different distributions
- [ ] Desktop environment specific notes

### 2. Developer Documentation
- [ ] Cross-platform development guide
- [ ] Platform abstraction API documentation
- [ ] Build system documentation
- [ ] Testing procedures

## Success Metrics

### 1. Compatibility
- [ ] Support for 5+ major Linux distributions
- [ ] 95% feature parity across platforms
- [ ] Successful installation on 90% of target systems

### 2. Performance
- [ ] Startup time <3 seconds on Linux
- [ ] Memory usage <100MB idle
- [ ] CPU usage <5% during recording

## Related Issues

- Performance optimization (affects all platforms)
- Testing improvements (cross-platform testing)
- UI/UX improvements (platform-specific UI patterns)
- Configuration system (platform-specific settings)

## Notes

- Linux support should not compromise existing platform functionality
- Consider security implications of different permission models
- Maintain consistent user experience across platforms
- Document platform-specific limitations and workarounds
- Plan for long-term maintenance of multiple platform codebases
