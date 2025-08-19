# SpeakMCP Mobile Server Implementation

This document describes the implementation of the mobile server functionality that allows SpeakMCP to host the 01-app mobile application with LiveKit and ngrok integration.

## Overview

The mobile server feature enables SpeakMCP to act as a server for the 01-app mobile application, providing:
- Real-time audio streaming via LiveKit WebRTC
- ngrok tunneling for secure external access
- QR code generation for easy mobile connection
- Integration with existing SpeakMCP MCP capabilities

## Architecture

### Core Components

1. **LiveKit Server (`src/main/livekit-server.ts`)**
   - Manages LiveKit rooms and participant connections
   - Handles audio track publishing/subscribing
   - Token generation for secure mobile connections
   - Audio processing pipeline integration

2. **ngrok Tunnel Manager (`src/main/ngrok-tunnel.ts`)**
   - Automatic tunnel creation and management
   - Dynamic URL generation for mobile connections
   - Health monitoring and reconnection handling

3. **QR Code Generator (`src/main/qr-generator.ts`)**
   - Generates connection QR codes with server URLs and tokens
   - Automatic refresh on tunnel URL changes
   - Token expiration and renewal

4. **Audio Pipeline (`src/main/audio-pipeline.ts`)**
   - WebRTC audio processing integration
   - Real-time audio buffering and STT/TTS processing
   - Format conversion for mobile compatibility

5. **Mobile Bridge (`src/main/mobile-bridge.ts`)**
   - Protocol bridge for 01-app compatibility
   - Session management and lifecycle handling
   - Integration layer between mobile and SpeakMCP

### Configuration

All mobile server configuration is available through the Settings panel:
- **General Settings** → **Mobile Server**
- Enable/disable mobile server
- LiveKit API credentials
- ngrok auth token
- Audio processing settings
- Session management options

## Setup Instructions

### 1. Prerequisites
- LiveKit Server API credentials
- ngrok account with auth token
- SpeakMCP installed and running

### 2. Configuration

#### Environment Variables
```bash
# LiveKit Configuration
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_secret
LIVEKIT_SERVER_PORT=7880

# ngrok Configuration
NGROK_AUTHTOKEN=your_ngrok_auth_token
NGROK_REGION=us
```

#### Through Settings UI
1. Open SpeakMCP Settings
2. Navigate to **Mobile Server** section
3. Configure:
   - LiveKit API Key and Secret
   - ngrok Auth Token
   - Server Port (default: 7880)
   - Audio settings
   - Session preferences

### 3. Usage

#### Starting the Mobile Server
1. Enable "Mobile Server" in settings
2. Click "Start Mobile Server" button
3. Wait for ngrok tunnel to establish
4. Generate QR code for mobile connection

#### Mobile App Connection
1. Open 01-app on your mobile device
2. Scan the QR code displayed in SpeakMCP
3. Start voice interaction

### 4. Features

#### Real-time Audio
- Mobile audio streams directly to SpeakMCP
- Real-time STT processing
- TTS responses streamed back to mobile
- Low-latency WebRTC communication

#### Security
- Token-based authentication
- Encrypted tunnel connections
- Session management and timeout
- Connection origin validation

#### Monitoring
- Active session list
- Connection status indicators
- QR code generation and refresh
- Session activity tracking

## API Endpoints

### IPC Handlers
- `startMobileServer()` - Starts the mobile server
- `stopMobileServer()` - Stops the mobile server
- `getMobileStatus()` - Gets current mobile server status
- `generateQRCode()` - Generates connection QR code
- `getMobileSessions()` - Gets active mobile sessions

### Events
- `mobileConnected` - Emitted when mobile device connects
- `mobileDisconnected` - Emitted when mobile device disconnects
- `transcriptReady` - Emitted when STT processing completes
- `tunnelReady` - Emitted when ngrok tunnel is ready

## Troubleshooting

### Common Issues

1. **Mobile Server Won't Start**
   - Check LiveKit API credentials
   - Verify ngrok auth token
   - Ensure port availability

2. **QR Code Not Generating**
   - Check ngrok tunnel status
   - Verify configuration values
   - Check network connectivity

3. **Mobile Connection Fails**
   - Verify ngrok URL accessibility
   - Check token validity
   - Ensure 01-app is updated

### Debug Logs
Enable debug mode to see detailed logs:
```bash
npm run dev -- --debug
```

## Integration with Existing Features

The mobile server integrates with existing SpeakMCP features:
- MCP tool execution from mobile voice commands
- Conversation history and management
- STT/TTS provider selection
- Model configuration
- Audio processing settings

## Development

### Adding New Features
1. Extend the mobile bridge protocol
2. Add corresponding IPC handlers
3. Update UI components
4. Add configuration options

### Testing
- Unit tests for individual components
- Integration tests for mobile connections
- End-to-end testing with 01-app
- Performance testing with multiple sessions

## Security Considerations

- All connections use HTTPS/WSS
- Token-based authentication with expiration
- Session management with timeout
- Input validation and sanitization
- Rate limiting for connection attempts
