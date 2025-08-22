# Text-to-Speech (TTS) Implementation for SpeakMCP

## Overview

This document describes the comprehensive Text-to-Speech (TTS) implementation added to SpeakMCP, which allows AI responses to be converted to audio and played back to users.

## Features

### ✅ Provider Support
- **OpenAI TTS**: Full support with 6 voices and 2 models (tts-1, tts-1-hd)
- **Groq TTS**: Full support with 19 English voices and 4 Arabic voices
- **Gemini TTS**: Full support with 30 voices and multi-language support

### ✅ Configuration Interface
- TTS provider selection in settings UI
- Voice/model selection dropdowns for each provider
- Provider-specific settings (speed, pitch, format)
- Text preprocessing configuration options

### ✅ Text Processing Pipeline
- Intelligent text preprocessing for speech-friendly content
- Code block removal/replacement
- URL and email address handling
- Markdown to natural speech conversion
- Symbol and technical formatting cleanup

### ✅ Audio Playback
- Integrated audio player with play/pause controls
- Volume control and progress tracking
- Compact mode for conversation display
- Error handling with graceful fallbacks

## Implementation Details

### Core Files

#### Backend (Main Process)
- `src/main/tts-preprocessing.ts` - Text preprocessing utilities
- `src/main/tipc.ts` - TTS API endpoints and provider implementations
- `src/shared/types.ts` - Configuration types for TTS settings
- `src/shared/index.ts` - TTS provider constants and voice options

#### Frontend (Renderer Process)
- `src/renderer/src/components/audio-player.tsx` - Audio playback component
- `src/renderer/src/components/ui/slider.tsx` - Custom slider component
- `src/renderer/src/components/conversation-display.tsx` - TTS integration in conversations
- `src/renderer/src/pages/settings-providers.tsx` - Provider-specific TTS settings
- `src/renderer/src/pages/settings-general.tsx` - General TTS settings

#### Tests
- `src/main/__tests__/tts-preprocessing.test.ts` - Text preprocessing unit tests
- `src/main/__tests__/tts-api.test.ts` - API integration unit tests
- `src/main/__tests__/tts-integration.test.ts` - End-to-end integration tests

### Configuration Schema

```typescript
interface TTSConfig {
  // General TTS Settings
  ttsEnabled?: boolean
  ttsProviderId?: "openai" | "groq" | "gemini"
  
  // OpenAI TTS
  openaiTtsModel?: "tts-1" | "tts-1-hd"
  openaiTtsVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
  openaiTtsSpeed?: number // 0.25 to 4.0
  openaiTtsResponseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"
  
  // Groq TTS
  groqTtsModel?: "playai-tts" | "playai-tts-arabic"
  groqTtsVoice?: string // 19 English + 4 Arabic voices
  
  // Gemini TTS
  geminiTtsModel?: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts"
  geminiTtsVoice?: string // 30 voice options
  geminiTtsLanguage?: string
  
  // Text Preprocessing
  ttsPreprocessingEnabled?: boolean
  ttsRemoveCodeBlocks?: boolean
  ttsRemoveUrls?: boolean
  ttsConvertMarkdown?: boolean
}
```

## Provider Details

### OpenAI TTS
- **API Endpoint**: `/v1/audio/speech`
- **Models**: `tts-1` (standard), `tts-1-hd` (high quality)
- **Voices**: 6 options with distinct characteristics
- **Features**: Speed control (0.25-4.0x), multiple output formats
- **Rate Limits**: Standard OpenAI API limits apply

### Groq TTS
- **API Endpoint**: `/openai/v1/audio/speech`
- **Models**: `playai-tts` (English), `playai-tts-arabic` (Arabic)
- **Voices**: 19 English voices, 4 Arabic voices
- **Features**: High-quality 24kHz WAV output
- **Rate Limits**: Groq-specific limits apply

### Gemini TTS
- **API Endpoint**: `/v1beta/models/{model}:generateContent`
- **Models**: `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`
- **Voices**: 30 voice options with personality descriptions
- **Features**: Multi-speaker support, 24 languages
- **Rate Limits**: Google AI API limits apply

## Text Preprocessing

The TTS preprocessing pipeline transforms technical content into speech-friendly text:

### Transformations Applied
1. **Code Blocks**: ````code``` → `[code block]`
2. **Inline Code**: `` `function()` `` → `function()`
3. **URLs**: `https://example.com` → `[web link]`
4. **Email**: `user@domain.com` → `[email address]`
5. **Headers**: `# Title` → `Heading: Title.`
6. **Lists**: `- Item` → `Item: Item.`
7. **Links**: `[text](url)` → `text`
8. **Symbols**: `>=` → `greater than or equal`, `&&` → `and`
9. **Versions**: `v1.2.3` → `version 1 point 2 point 3`

### Configuration Options
- Enable/disable preprocessing globally
- Granular control over each transformation type
- Text length limits and truncation
- Validation before TTS generation

## Error Handling

### Graceful Fallbacks
- **API Failures**: User-friendly error messages, text remains available
- **Network Issues**: Automatic retry suggestions
- **Invalid Content**: Preprocessing validation with specific error details
- **Missing API Keys**: Clear configuration guidance

### Error Types and Messages
- `TTS API key not configured` - Missing authentication
- `Rate limit exceeded. Please try again later` - API rate limiting
- `Network error. Please check your connection` - Connectivity issues
- `Text content is not suitable for TTS` - Validation failures

## Testing

### Test Coverage
- **Unit Tests**: Text preprocessing functions and validation
- **API Tests**: Provider-specific API call mocking and error handling
- **Integration Tests**: Complete TTS pipeline from text to audio
- **Error Scenarios**: Comprehensive error handling validation

### Running Tests
```bash
# Run all TTS tests
npm run test:tts

# Run all tests with coverage
npm run test:coverage

# Run tests in watch mode
npm test

# Run tests with UI
npm run test:ui
```

## Usage

### Enabling TTS
1. Go to Settings → General
2. Enable "Text to Speech"
3. Configure preprocessing options as needed

### Configuring Providers
1. Go to Settings → Providers
2. Select your preferred TTS provider
3. Configure provider-specific settings (voice, model, speed)
4. Ensure API keys are configured for your chosen provider

### Using TTS in Conversations
1. TTS controls appear automatically on assistant messages when enabled
2. Click the play button to generate and play audio
3. Use volume and progress controls as needed
4. Audio generation happens on-demand to save resources

## Performance Considerations

### Optimization Strategies
- **On-demand Generation**: Audio is only generated when requested
- **Text Preprocessing**: Reduces API payload size and improves speech quality
- **Error Caching**: Failed generations don't retry automatically
- **Format Selection**: Choose appropriate audio formats for your use case

### Resource Usage
- **Memory**: Audio buffers are cleaned up after playback
- **Network**: API calls only made when user requests audio
- **Storage**: No persistent audio caching (privacy-focused)

## Future Enhancements

### Potential Improvements
- **Voice Cloning**: Custom voice training for personalized TTS
- **SSML Support**: Advanced speech markup for better control
- **Streaming TTS**: Real-time audio generation for long texts
- **Offline TTS**: Local TTS engines for privacy and performance
- **Audio Caching**: Optional local caching for frequently accessed content

### Provider Expansion
- **Azure Cognitive Services**: Additional enterprise-grade TTS
- **AWS Polly**: More voice options and neural voices
- **ElevenLabs**: High-quality AI voice synthesis
- **Local Models**: Whisper-style local TTS models

## Troubleshooting

### Common Issues
1. **No audio generated**: Check API keys and network connectivity
2. **Poor audio quality**: Try different voice/model combinations
3. **Slow generation**: Consider using faster models or shorter text
4. **Playback issues**: Verify browser audio permissions and settings

### Debug Information
- Check browser console for detailed error messages
- Verify API key configuration in settings
- Test with simple text first before complex content
- Ensure preprocessing is working correctly for technical content

## Security and Privacy

### Data Handling
- **No Audio Storage**: Generated audio is not persisted locally
- **API Security**: All API calls use secure HTTPS connections
- **Key Management**: API keys stored securely in application config
- **Content Privacy**: Text preprocessing happens locally before API calls

### Best Practices
- Use environment variables for API keys in development
- Regularly rotate API keys
- Monitor API usage and costs
- Review text content before TTS generation for sensitive information
