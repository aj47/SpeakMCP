# Wake Word Implementation

This document describes the wake word detection feature implementation in SpeakMCP, which enables hands-free voice activation using wake word detection as an alternative to keyboard shortcuts.

## Overview

The wake word feature allows users to activate SpeakMCP by speaking a predefined wake word (e.g., "Hey Computer") instead of using keyboard shortcuts. This implementation uses the Web Speech API for completely local, free, and privacy-focused wake word detection.

## Architecture

### Core Components

1. **Wake Word Service** (`src/main/wake-word-service.ts`)
   - Event-driven architecture using Node.js EventEmitter
   - Manages detection lifecycle (initialize, start, stop, cleanup)
   - Handles configuration updates and state management
   - Uses Web Speech API through a hidden Electron window

2. **Configuration System** (`src/shared/types.ts`, `src/main/config.ts`)
   - Type-safe wake word configuration
   - Persistent storage of user preferences
   - Default configuration with sensible defaults

3. **IPC Communication** (`src/main/tipc.ts`)
   - Type-safe communication between main and renderer processes
   - Wake word service control methods
   - Status monitoring and configuration updates

4. **User Interface** (`src/renderer/src/pages/settings-wake-word.tsx`)
   - Comprehensive settings page for wake word configuration
   - Real-time status monitoring
   - Manual control buttons for testing
   - Privacy and setup information

## Configuration Options

### WakeWordConfig Interface

```typescript
interface WakeWordConfig {
  enabled?: boolean                    // Enable/disable wake word detection
  wakeWord?: string                   // Selected wake word
  sensitivity?: number                // Detection sensitivity (0.1 - 1.0)
  recordingTimeout?: number           // Timeout before resuming detection (seconds)
  confirmationMode?: boolean          // Show confirmation dialog before recording
}
```

### Available Wake Words

- "hey computer" (default)
- "hey assistant"
- "wake up"
- "listen up"
- "computer"
- "assistant"
- "hello computer"
- "hello assistant"
- "start listening"
- "activate"
- "voice command"

### Default Settings

```typescript
wakeWord: {
  enabled: false,
  wakeWord: "hey computer",
  sensitivity: 0.5,
  recordingTimeout: 5,
  confirmationMode: false,
}
```

## Web Speech API Implementation

The implementation uses the Web Speech API for wake word detection:

### How It Works

1. **Hidden Window**: Creates a hidden Electron BrowserWindow for Web Speech API access
2. **Continuous Recognition**: Uses `webkitSpeechRecognition` with continuous listening
3. **Wake Word Matching**: Monitors transcript for configured wake words
4. **Event Emission**: Triggers recording when wake word is detected
5. **Auto-Restart**: Automatically restarts recognition if it stops

### Key Features

- **No External Dependencies**: Uses browser's built-in speech recognition
- **Completely Local**: All processing happens on device
- **Free**: No API keys or subscriptions required
- **Real-time**: Immediate wake word detection
- **Customizable**: Support for any wake phrase

### Technical Implementation

```typescript
// Web Speech API setup in hidden window
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
recognition = new SpeechRecognition();

recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-US';

recognition.onresult = (event) => {
  const transcript = event.results[i][0].transcript.toLowerCase().trim();

  if (transcript.includes(config.wakeWord.toLowerCase())) {
    // Wake word detected!
    window.postMessage({
      type: 'wakeWordDetected',
      data: { wakeWord, transcript, timestamp, confidence }
    }, '*');
  }
};
```

## Integration with Recording System

### Wake Word Detection Flow

1. **Detection**: Wake word service detects the configured wake word
2. **Event Emission**: Service emits `wakeWordDetected` event
3. **Recording Trigger**: Event handler triggers voice recording
4. **Timeout**: Detection pauses for configured timeout period
5. **Resume**: Detection automatically resumes after timeout

### Event Handling

The wake word service emits the following events:

- `detectionStarted`: When detection begins
- `detectionStopped`: When detection stops
- `wakeWordDetected`: When wake word is detected
- `detectionError`: When an error occurs

## Privacy & Performance

### Privacy-First Design

- ✅ All processing happens locally on device
- ✅ No audio data sent to external servers
- ✅ User control with ability to disable at any time
- ✅ Transparent operation with clear status indicators

### Performance Optimizations

- ✅ Minimal system resource usage
- ✅ Smart pausing during recording to avoid conflicts
- ✅ Configurable sensitivity to balance accuracy and false positives
- ✅ Proper timeout management

## File Structure

### New Files

- `src/main/wake-word-service.ts` - Core wake word detection service
- `src/renderer/src/pages/settings-wake-word.tsx` - Wake word settings UI
- `src/renderer/src/components/ui/slider.tsx` - Sensitivity control component
- `docs/wake-word-implementation.md` - This documentation

### Modified Files

- `src/shared/types.ts` - Added wake word configuration types
- `src/main/config.ts` - Added default wake word settings
- `src/main/tipc.ts` - Added wake word IPC methods
- `src/main/index.ts` - Service initialization and cleanup
- `src/renderer/src/router.tsx` - Added wake word route
- `src/renderer/src/components/app-layout.tsx` - Added navigation link
- `package.json` - Added Picovoice dependencies

## API Reference

### IPC Methods

- `initializeWakeWordService()` - Initialize the wake word service
- `startWakeWordDetection()` - Start wake word detection
- `stopWakeWordDetection()` - Stop wake word detection
- `getWakeWordStatus()` - Get current detection status and config
- `updateWakeWordSettings(settings)` - Update wake word configuration
- `getAvailableWakeWords()` - Get list of available wake words

### Service Methods

- `initialize()` - Initialize the service
- `startDetection()` - Start detection
- `stopDetection()` - Stop detection
- `cleanup()` - Clean up resources
- `updateSettings(config)` - Update configuration
- `isDetectionActive()` - Check if detection is active
- `getConfig()` - Get current configuration
- `getAvailableWakeWords()` - Get available wake words

## Testing

### Manual Testing Steps

1. Navigate to Settings → Wake Word
2. Enable wake word detection
3. Configure desired settings (wake word, sensitivity, timeout)
4. Start detection and verify status indicators
5. Test manual start/stop controls
6. Verify demo detection triggers recording after 30 seconds

### Verification Checklist

- ✅ TypeScript compilation passes for Node.js side
- ✅ All new IPC methods properly typed
- ✅ Settings UI renders correctly
- ✅ Navigation integration works
- ✅ Service lifecycle management functional
- ✅ Demo mode triggers recording as expected

## Future Enhancements

- **Custom Wake Words**: Train user-specific wake phrases
- **Multiple Wake Words**: Support simultaneous detection of multiple phrases
- **Voice Profiles**: User-specific voice recognition
- **Advanced Filtering**: Noise reduction and echo cancellation
- **Performance Metrics**: Detection accuracy and response time tracking

## Troubleshooting

### Common Issues

1. **Detection Not Starting**: Check if wake word is enabled in settings
2. **No Detection Events**: Verify service is initialized and detection is active
3. **High False Positives**: Reduce sensitivity setting
4. **Missed Detections**: Increase sensitivity setting
5. **Performance Issues**: Check system resources and adjust timeout settings

### Debug Information

The service logs important events to the diagnostics system:

- Service initialization
- Detection start/stop events
- Configuration updates
- Error conditions

Access debug information through the diagnostics API or console logs.
