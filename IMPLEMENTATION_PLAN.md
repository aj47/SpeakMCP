# SpeakMCP-01 Integration Implementation Plan

## Overview

This document outlines the comprehensive implementation plan for integrating SpeakMCP with the 01-app mobile application. The integration will enable SpeakMCP to host a LiveKit server that can be tunneled through ngrok, allowing the 01-app to connect and interact with SpeakMCP's advanced MCP capabilities via real-time audio streaming.

## Architecture Analysis

### 01-App Mobile Application
- **Technology**: React Native with LiveKit WebRTC integration
- **Communication**: Real-time audio streaming (not text-based)
- **Connection**: QR code scanning for server URL and authentication tokens
- **Audio Flow**: Mobile captures audio → WebRTC stream → LiveKit server
- **Response Flow**: LiveKit server → WebRTC audio stream → Mobile playback

### SpeakMCP Current Architecture
- **Platform**: Electron desktop application
- **Core**: MCP (Model Context Protocol) integration
- **Audio**: Multiple STT/TTS providers (OpenAI, Groq, ElevenLabs, Deepgram)
- **LLM**: Advanced processing with agent mode capabilities
- **UI**: Desktop-focused with panel windows and system integration

## Implementation Phases

### Phase 1: Core LiveKit Integration

#### 1.1 Dependencies Installation
```bash
npm install livekit-server-sdk livekit-client qrcode ngrok ws
npm install @types/ws @types/qrcode --save-dev
```

#### 1.2 LiveKit Server Module (`src/main/livekit-server.ts`)
**Key Components:**
- LiveKit room management
- Participant connection handling
- Audio track publishing/subscribing
- WebRTC audio stream processing
- Integration with existing SpeakMCP audio pipeline

**Core Functions:**
- `startLiveKitServer()`: Initialize LiveKit server
- `createRoom()`: Create audio rooms for mobile connections
- `handleParticipantConnected()`: Manage new mobile app connections
- `processAudioTrack()`: Handle incoming audio streams from mobile
- `publishAudioResponse()`: Send TTS audio back to mobile

#### 1.3 Audio Processing Pipeline (`src/main/audio-pipeline.ts`)
**WebRTC Audio Integration:**
- Convert WebRTC audio chunks to format compatible with STT providers
- Real-time audio buffering and processing
- Integration with existing STT providers (Whisper, Groq, Deepgram)
- TTS response streaming back to WebRTC

**Pipeline Flow:**
```
WebRTC Audio → Audio Buffer → STT → MCP Processing → TTS → WebRTC Response
```

### Phase 2: Server Infrastructure

#### 2.1 Ngrok Tunnel Management (`src/main/ngrok-tunnel.ts`)
**Features:**
- Automatic tunnel creation and management
- Dynamic URL generation for mobile app connection
- Tunnel health monitoring and reconnection
- Secure token-based authentication

**Configuration:**
- Environment variable for ngrok auth token
- Configurable tunnel region and domain
- SSL/TLS termination handling

#### 2.2 QR Code Generation (`src/main/qr-generator.ts`)
**QR Code Content:**
```json
{
  "serverUrl": "wss://abc123.ngrok.io",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "roomName": "speakmcp-session-001"
}
```

**Features:**
- Generate connection QR codes with server URL and tokens
- Display QR code in SpeakMCP interface
- Auto-refresh on tunnel URL changes
- Token expiration and renewal

#### 2.3 Mobile Bridge Protocol (`src/main/mobile-bridge.ts`)
**Protocol Translation:**
- Map 01-app expected LiveKit protocol to SpeakMCP capabilities
- Handle mobile app connection lifecycle
- Manage session state and persistence
- Bridge mobile audio streams with MCP tool execution

### Phase 3: Configuration & Security

#### 3.1 Configuration Management
**New Config Options in `src/shared/types.ts`:**
```typescript
interface Config {
  // Existing config...
  
  // Mobile Server Configuration
  mobileServerEnabled: boolean
  livekitServerPort: number
  livekitApiKey: string
  livekitApiSecret: string
  
  // Ngrok Configuration
  ngrokTunnelEnabled: boolean
  ngrokAuthToken: string
  ngrokRegion: string
  
  // Mobile Session Settings
  qrCodeDisplayEnabled: boolean
  mobileSessionTimeout: number
  maxConcurrentMobileSessions: number
  
  // Audio Processing
  mobileAudioSampleRate: number
  mobileAudioBitrate: number
  audioBufferSize: number
}
```

#### 3.2 Environment Variables
```env
# LiveKit Configuration
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_secret
LIVEKIT_SERVER_PORT=7880

# Ngrok Configuration
NGROK_AUTHTOKEN=your_ngrok_auth_token
NGROK_REGION=us

# Audio Processing
DEEPGRAM_API_KEY=your_deepgram_key
ELEVEN_API_KEY=your_elevenlabs_key
```

#### 3.3 Security Implementation
**Authentication:**
- JWT token generation for mobile connections
- Token expiration and refresh mechanisms
- Rate limiting for connection attempts

**Connection Security:**
- WSS (WebSocket Secure) for all connections
- Token-based room access control
- Connection origin validation

### Phase 4: User Interface Integration

#### 4.1 Mobile Server Panel (`src/renderer/src/components/mobile-server-panel.tsx`)
**Features:**
- Enable/disable mobile server toggle
- QR code display for mobile connection
- Connected mobile devices list
- Server status and connection metrics
- Audio processing status indicators

#### 4.2 Settings Integration
**Add to existing settings:**
- Mobile server configuration section
- LiveKit server settings
- Ngrok tunnel preferences
- Audio quality settings for mobile
- Session management options

### Phase 5: Audio Processing Implementation

#### 5.1 Real-time Audio Handling
**WebRTC Audio Processing:**
- Handle incoming audio tracks from LiveKit
- Convert audio format for STT providers
- Implement audio buffering for continuous speech
- Voice Activity Detection (VAD) for better processing

#### 5.2 STT Integration
**Enhanced STT Pipeline:**
- Real-time streaming STT for mobile audio
- Integration with existing providers (Whisper, Groq, Deepgram)
- Configurable STT provider selection for mobile sessions
- Audio quality optimization for mobile networks

#### 5.3 TTS Response Streaming
**Real-time TTS:**
- Stream TTS responses back to mobile in real-time
- Audio format optimization for WebRTC
- Latency optimization for responsive conversation
- Integration with existing TTS providers (ElevenLabs, etc.)

## Technical Implementation Details

### Core Files to Create/Modify

#### New Files:
1. `src/main/livekit-server.ts` - Core LiveKit server implementation
2. `src/main/ngrok-tunnel.ts` - Ngrok tunnel management
3. `src/main/mobile-bridge.ts` - Protocol bridge for 01-app compatibility
4. `src/main/qr-generator.ts` - QR code generation for mobile connection
5. `src/main/audio-pipeline.ts` - WebRTC audio processing integration
6. `src/renderer/src/components/mobile-server-panel.tsx` - UI for mobile server

#### Modified Files:
1. `src/shared/types.ts` - Extended types for mobile server functionality
2. `src/main/config.ts` - Add mobile server configuration options
3. `src/main/tipc.ts` - Add mobile server IPC handlers
4. `src/renderer/src/components/settings.tsx` - Add mobile server settings

### Expected User Experience

#### Setup Flow:
1. **Enable Mobile Server**: User toggles mobile server mode in SpeakMCP settings
2. **Server Startup**: LiveKit server starts, ngrok tunnel established automatically
3. **QR Code Display**: Connection QR code appears in SpeakMCP interface
4. **Mobile Connection**: User scans QR code with 01-app
5. **Voice Interaction**: Real-time voice communication between mobile app and SpeakMCP
6. **Tool Execution**: Voice commands trigger MCP tools through SpeakMCP's existing pipeline

#### Interaction Flow:
1. User speaks into 01-app mobile application
2. Audio streams via WebRTC to SpeakMCP LiveKit server
3. SpeakMCP processes audio through STT → LLM → MCP tools
4. Response generated and converted to speech via TTS
5. Audio response streamed back to mobile app via WebRTC
6. User hears response through mobile app

## Benefits of This Integration

- **Unified AI Assistant**: Use SpeakMCP's advanced MCP capabilities from mobile
- **Remote Access**: Control your computer and tools from anywhere via mobile
- **Existing Infrastructure**: Leverage SpeakMCP's mature LLM and tool ecosystem
- **Cross-Platform**: Bridge desktop AI capabilities to mobile interface
- **Real-time Communication**: Low-latency voice interaction via WebRTC
- **Secure Connection**: Encrypted tunneling with token-based authentication

## Next Steps

1. Begin with Phase 1: Core LiveKit Integration
2. Implement basic audio streaming pipeline
3. Add ngrok tunneling and QR code generation
4. Test mobile app connectivity
5. Enhance with advanced features and security
6. Comprehensive testing and optimization

This implementation will transform SpeakMCP into a powerful server that can host the 01-app mobile application, providing remote access to desktop AI assistant capabilities through a professional mobile interface.
