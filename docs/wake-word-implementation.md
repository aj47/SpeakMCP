# Wake Word Support Implementation

## Overview

This document describes the implementation of wake word detection support for SpeakMCP, addressing GitHub issue #34. The implementation provides hands-free voice activation using wake word detection as an alternative to keyboard shortcuts.

## Architecture

### Core Components

1. **Wake Word Service** (`src/main/wake-word-service.ts`)
   - Main service handling wake word detection
   - Event-driven architecture with EventEmitter
   - Demo implementation with plans for Picovoice integration

2. **Configuration System**
   - Extended `Config` type with wake word settings
   - Default configuration in `src/main/config.ts`
   - Persistent storage of user preferences

3. **IPC Integration** (`src/main/tipc.ts`)
   - Type-safe communication between main and renderer processes
   - Wake word control methods exposed to UI

4. **Settings UI** (`src/renderer/src/pages/settings-wake-word.tsx`)
   - Comprehensive settings interface
   - Real-time status monitoring
   - Privacy and performance information

## Features Implemented

### ✅ Configuration Options
- **Enable/Disable Wake Word Detection**: Toggle functionality on/off
- **Customizable Wake Words**: Support for multiple built-in keywords
- **Sensitivity Control**: Adjustable detection sensitivity (0.1 - 1.0)
- **Recording Timeout**: Configurable timeout before resuming detection
- **Confirmation Mode**: Optional confirmation dialog before recording

### ✅ User Interface
- **Settings Page**: Dedicated wake word configuration interface
- **Status Indicators**: Real-time listening status display
- **Control Buttons**: Manual start/stop detection controls
- **Setup Instructions**: Clear guidance for Picovoice access key setup

### ✅ Integration Points
- **Navigation**: Added to main settings navigation
- **Router**: Integrated with React Router
- **IPC Methods**: Full communication layer implemented
- **Service Lifecycle**: Proper initialization and cleanup

## Configuration Schema

```typescript
// Wake Word Configuration
wakeWordEnabled?: boolean              // Enable/disable feature
wakeWordKeyword?: string              // Selected wake word
wakeWordSensitivity?: number          // Detection sensitivity (0.1-1.0)
wakeWordTimeout?: number              // Timeout in milliseconds
wakeWordRequireConfirmation?: boolean // Show confirmation dialog
```

### Default Values
```typescript
wakeWordEnabled: false
wakeWordKeyword: "hey computer"
wakeWordSensitivity: 0.5
wakeWordTimeout: 5000
wakeWordRequireConfirmation: false
```

## Available Wake Words

The implementation supports these built-in wake words:
- "Hey Computer" (default)
- "Hey Porcupine"
- "Hey Picovoice"
- "Alexa"
- "OK Google"
- "Hey Siri"

## Technical Implementation

### Wake Word Service Events

```typescript
// Service Events
'listening-started'              // Detection started
'listening-stopped'              // Detection stopped
'listening-paused'               // Temporarily paused
'listening-resumed'              // Resumed after pause
'wake-word-detected'             // Wake word detected
'wake-word-confirmation-required' // Confirmation needed
'error'                          // Error occurred
'initialized'                    // Service initialized
```

### IPC Methods

```typescript
// Available IPC methods
startWakeWordDetection()         // Start listening
stopWakeWordDetection()          // Stop listening
getWakeWordStatus()              // Get current status
updateWakeWordConfiguration()    // Apply config changes
setWakeWordAccessKey()           // Set Picovoice access key
```

### Integration with Recording System

When a wake word is detected:
1. **Pause Detection**: Temporarily stop listening to avoid interference
2. **Trigger Recording**: Call `showPanelWindowAndStartMcpRecording()`
3. **Resume After Timeout**: Restart detection after configured timeout
4. **Handle Confirmation**: Show confirmation dialog if enabled

## Demo Implementation

The current implementation includes a demo mode that:
- Simulates wake word detection every 30 seconds
- Provides full UI functionality without requiring Picovoice setup
- Logs detection events for testing
- Demonstrates the complete workflow

## Production Setup (Future)

For production use with real wake word detection:

1. **Get Picovoice Access Key**
   - Sign up at https://console.picovoice.ai/
   - Get free access key for development

2. **Install Dependencies**
   ```bash
   npm install @picovoice/porcupine-node @picovoice/pvrecorder-node
   ```

3. **Configure Service**
   - Uncomment Picovoice imports in `wake-word-service.ts`
   - Replace demo implementation with actual Porcupine integration
   - Set access key through settings UI

## Privacy & Performance

### Privacy Features
- **Local Processing**: All detection happens on-device
- **No Data Transmission**: Audio never leaves the user's machine
- **User Control**: Can be disabled at any time
- **Transparent Operation**: Clear status indicators

### Performance Optimizations
- **Minimal Resource Usage**: Efficient audio processing
- **Smart Pausing**: Stops during recording to avoid conflicts
- **Configurable Sensitivity**: Balance between accuracy and false positives
- **Timeout Management**: Prevents indefinite listening states

## File Structure

```
src/
├── main/
│   ├── wake-word-service.ts      # Core wake word detection service
│   ├── config.ts                 # Configuration with wake word defaults
│   ├── tipc.ts                   # IPC methods for wake word control
│   └── index.ts                  # Service initialization
├── renderer/src/
│   ├── pages/
│   │   └── settings-wake-word.tsx # Wake word settings UI
│   ├── components/
│   │   ├── app-layout.tsx        # Navigation integration
│   │   └── ui/
│   │       └── slider.tsx        # Sensitivity control component
│   └── router.tsx                # Route configuration
├── shared/
│   └── types.ts                  # Wake word configuration types
└── docs/
    └── wake-word-implementation.md # This documentation
```

## Testing

### Manual Testing
1. Navigate to Settings → Wake Word
2. Enable wake word detection
3. Configure desired settings
4. Start detection and verify status indicators
5. Test manual start/stop controls

### Demo Mode Testing
- Detection simulates every 30 seconds when active
- Check console logs for detection events
- Verify recording panel activation
- Test configuration changes

## Future Enhancements

### Planned Features
- **Custom Wake Words**: Train user-specific wake phrases
- **Multiple Wake Words**: Support simultaneous detection of multiple phrases
- **Voice Profiles**: User-specific voice recognition
- **Advanced Filtering**: Noise reduction and echo cancellation
- **Performance Metrics**: Detection accuracy and response time tracking

### Integration Opportunities
- **Smart Home Integration**: Connect with IoT devices
- **Context Awareness**: Different wake words for different modes
- **Voice Commands**: Extend beyond just recording activation
- **Multi-language Support**: Wake words in different languages

## Troubleshooting

### Common Issues
1. **Service Not Starting**: Check if wake word is enabled in settings
2. **No Detection**: Verify microphone permissions and access key
3. **False Positives**: Adjust sensitivity settings
4. **Performance Issues**: Check system resources and timeout settings

### Debug Information
- Service status available in settings UI
- Console logs show detection events
- IPC communication can be monitored in dev tools

## Conclusion

This implementation provides a solid foundation for wake word support in SpeakMCP. The demo mode allows immediate testing and development, while the architecture supports easy integration with production wake word detection libraries like Picovoice Porcupine.

The feature enhances accessibility and user experience by enabling hands-free operation, making SpeakMCP more natural and convenient to use.
