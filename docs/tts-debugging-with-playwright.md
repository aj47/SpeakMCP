# TTS Debugging with Playwright MCP Tools

This guide explains how to use SpeakMCP's web debugging mode to debug TTS (Text-to-Speech) responses using Playwright MCP tools for web automation and content extraction.

## Overview

The TTS debugging workflow combines:
- **Web Debugging Mode**: Production-like debugging environment with real MCP integration
- **Playwright MCP Tools**: Web automation for content extraction from live websites
- **TTS Debug Service**: Comprehensive TTS generation testing and analysis
- **Real-time Logging**: Structured logging with TTS-specific categories

## Quick Start

### 1. Start Web Debug Server with TTS Support

```bash
# Start with TTS debugging enabled
WEB_DEBUG_LOG_LEVEL=debug npm run dev:web

# Or with full verbose logging
npm run debug:web
```

### 2. Access the TTS Debug Interface

1. Navigate to `http://localhost:3001`
2. Click the **"TTS Debug"** tab in the navigation
3. The TTS Debug Panel will load with four main sections:
   - **Generator**: Manual TTS testing
   - **History**: TTS generation results
   - **Preprocessing**: Text preprocessing analysis
   - **Scenarios**: Playwright automation scenarios

## TTS Debug Panel Features

### Generator Tab

Test TTS generation with custom text and settings:

- **Test Text**: Enter any text for TTS conversion
- **Provider Selection**: Choose between OpenAI, Groq, or Gemini
- **Voice & Model**: Select specific voices and models per provider
- **Speed Control**: Adjust playback speed (0.25x to 4.0x)
- **Preprocessing Options**: Configure text preprocessing:
  - Remove code blocks
  - Remove URLs
  - Convert Markdown formatting
  - Set maximum text length

**Example Usage:**
```
Test Text: "Check out this code: `console.log('hello')` and visit https://example.com"
Provider: OpenAI
Voice: alloy
Preprocessing: Enabled (removes code and URLs)
Result: "Check out this code: console.log hello and visit [URL]"
```

### History Tab

View all TTS generation attempts with:
- Success/failure status
- Provider and timing information
- Audio file size and duration
- Playback controls for successful generations
- Error details for failed attempts

### Preprocessing Tab

Analyze text preprocessing results:
- Original vs processed text comparison
- Character count reduction statistics
- Validation issues and warnings
- Preprocessing options applied

### Scenarios Tab

Run automated Playwright scenarios that:
1. Navigate to web pages
2. Extract content using CSS selectors
3. Generate TTS from extracted text
4. Test various content types and edge cases

## Playwright TTS Scenarios

### Built-in Scenarios

#### 1. News Article TTS
- **Purpose**: Test TTS with news content
- **MCP Tools**: `browser_navigate_Playwright`, `browser_snapshot_Playwright`, `browser_take_screenshot_Playwright`
- **Actions**: Navigate to news site, extract article text using accessibility snapshot
- **TTS Config**: OpenAI with preprocessing enabled
- **Tests**: URL removal, markdown conversion, content length handling

#### 2. Technical Documentation TTS
- **Purpose**: Handle code blocks and technical content
- **MCP Tools**: `browser_navigate_Playwright`, `browser_snapshot_Playwright`
- **Actions**: Extract from GitHub docs using accessibility snapshot
- **TTS Config**: Groq with code block removal
- **Tests**: Code block handling, technical term preservation

#### 3. Search Results TTS
- **Purpose**: Process mixed content types
- **MCP Tools**: `browser_navigate_Playwright`, `browser_type_Playwright`, `browser_press_key_Playwright`, `browser_snapshot_Playwright`
- **Actions**: Perform search, extract result snippets using real browser automation
- **TTS Config**: Gemini with URL removal
- **Tests**: Content concatenation, varied formatting

#### 4. Form Interaction TTS
- **Purpose**: TTS feedback for form submissions
- **MCP Tools**: `browser_navigate_Playwright`, `browser_type_Playwright`, `browser_click_Playwright`, `browser_snapshot_Playwright`
- **Actions**: Fill and submit forms using real form interaction, extract responses
- **TTS Config**: OpenAI HD with JSON handling
- **Tests**: Structured data processing, confirmation messages

#### 5. Error Page TTS
- **Purpose**: Handle edge cases and errors
- **MCP Tools**: `browser_navigate_Playwright`, `browser_snapshot_Playwright`, `browser_take_screenshot_Playwright`
- **Actions**: Navigate to 404 pages, extract error content
- **TTS Config**: Basic OpenAI with short text handling
- **Tests**: Error communication, edge case stability

### Running Scenarios

1. Go to the **Scenarios** tab
2. Click **"Run Scenario"** for any built-in scenario
3. Monitor the Debug Logs Panel for real-time progress
4. Check the History tab for TTS generation results

## Debug Logging

### TTS-Specific Log Categories

The web debugging mode includes specialized logging for TTS:

- **`tts`**: Main TTS generation events
- **`tts-preprocessing`**: Text preprocessing steps
- **`tts-validation`**: Text validation results
- **`tool-call`**: Playwright MCP tool executions
- **`agent`**: Agent mode processing steps

### Log Level Configuration

```bash
# Set log level for detailed TTS debugging
WEB_DEBUG_LOG_LEVEL=debug npm run dev:web

# Trace level for maximum detail
WEB_DEBUG_LOG_LEVEL=trace npm run dev:web
```

### Example Log Output

```
[2024-01-15T10:30:25.123Z] [INFO ] [TTS         ] Starting TTS generation with openai [session:abc12345]
[2024-01-15T10:30:25.124Z] [DEBUG] [TTS-PREPROCESSING] Text preprocessing completed [333ms]
[2024-01-15T10:30:25.125Z] [DEBUG] [TTS-VALIDATION] TTS validation passed
[2024-01-15T10:30:26.456Z] [INFO ] [TTS         ] TTS generation completed with openai [1333ms] [tool:def67890]
```

## Advanced Usage

### Custom Playwright Scenarios

Create custom scenarios by extending the `TTSPlaywrightScenarioRunner`:

```typescript
const customScenario: TTSScenario = {
  id: 'custom-test',
  name: 'Custom TTS Test',
  description: 'Test TTS with custom web content',
  playwrightActions: [
    {
      type: 'navigate',
      url: 'https://your-site.com',
      description: 'Navigate to custom site'
    },
    {
      type: 'extract_text',
      selector: '.content',
      description: 'Extract main content'
    }
  ],
  ttsConfig: {
    provider: 'openai',
    voice: 'nova',
    enablePreprocessing: true
  },
  expectedOutcomes: [
    'Content should be extracted successfully',
    'TTS should handle custom formatting'
  ]
}
```

### Real Playwright MCP Server Integration

The web debugging mode uses the actual Playwright MCP server for authentic web automation:

1. **Automatic Integration**: The web debug mode automatically connects to the configured Playwright MCP server
2. **Real Web Automation**: All scenarios execute actual browser automation using Playwright
3. **Production MCP Stack**: Uses the same MCP infrastructure as the main SpeakMCP application
4. **Tool Call Logging**: All Playwright tool calls are logged with detailed timing and results

### TTS Provider Comparison

Use the debug interface to compare TTS providers:

1. Generate the same text with different providers
2. Compare audio quality, generation time, and file sizes
3. Test different voices and models
4. Analyze preprocessing effectiveness per provider

## Troubleshooting

### Common Issues

**TTS Generation Fails**
- Check API keys are configured
- Verify provider-specific requirements (e.g., Groq terms acceptance)
- Review preprocessing validation errors

**Playwright Scenarios Don't Work**
- Ensure Playwright MCP server is running
- Check network connectivity to target websites
- Verify CSS selectors are correct for content extraction

**No Audio Playback**
- Check browser audio permissions
- Verify audio format compatibility
- Look for CORS issues in browser console

### Debug Information Collection

1. Set log level to `debug` or `trace`
2. Run the failing scenario
3. Use "Download logs" in the Debug Logs Panel
4. Include logs when reporting issues

## Best Practices

### Text Preprocessing
- Always enable preprocessing for web-extracted content
- Adjust max length based on TTS provider limits
- Test with various content types (news, docs, forms)

### Scenario Design
- Use realistic websites that are stable
- Include error handling for network issues
- Test both success and failure cases

### Performance Testing
- Monitor TTS generation times
- Compare file sizes across providers
- Test with various text lengths

### Logging Strategy
- Use appropriate log levels for different environments
- Filter logs by category for focused debugging
- Export logs for offline analysis

## Integration with Main Application

The web debugging mode uses the same MCP infrastructure as the main SpeakMCP application:

- **Real MCP Servers**: Connects to actual configured MCP servers
- **Production TTS Stack**: Uses the same TTS generation pipeline
- **Shared Configuration**: Respects main app TTS settings
- **Agent Mode**: Full agent processing with tool calls

This ensures that debugging results accurately reflect production behavior.
