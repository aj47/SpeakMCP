# Sample SpeakMCP Configurations

This directory contains pre-configured JSON files that you can import into SpeakMCP to quickly set up the example MCP servers.

## Available Configurations

### `basic-examples.json`
**Recommended for beginners** - Includes servers that work without external dependencies:
- Filesystem Example (file operations)
- Calculator Example (mathematical computations)
- Database Example (SQLite operations)

### `all-examples.json`
**Complete setup** - Includes all example servers:
- All basic examples (above)
- Weather Example (requires API key)
- Web Scraper Example (web content extraction)

## How to Import

### Method 1: File Import (Recommended)
1. Open SpeakMCP
2. Go to Settings → MCP Tools
3. Click "Import Configuration"
4. Select "From File"
5. Choose one of the JSON files from this directory
6. Click "Import"

### Method 2: Text Import
1. Open SpeakMCP
2. Go to Settings → MCP Tools
3. Click "Import Configuration"
4. Select "From Text"
5. Copy and paste the contents of a JSON file
6. Click "Import"

## Setup Requirements

### Basic Examples (No Setup Required)
The basic examples work immediately after import:
- **Filesystem**: Creates a sandbox directory automatically
- **Calculator**: Pure JavaScript, no dependencies
- **Database**: Creates SQLite database automatically

### Weather Example (API Key Required)
1. Get a free API key from [OpenWeatherMap](https://openweathermap.org/api)
2. After importing, edit the weather-example server
3. Replace `"your-api-key-here"` with your actual API key
4. Save the configuration

### Web Scraper Example (No Setup Required)
Works immediately but respects rate limits:
- 10 requests per minute per domain
- Only HTTP/HTTPS URLs allowed

## Installation Steps

Before importing configurations, make sure to install dependencies:

```bash
# Install all example dependencies
cd examples/filesystem && npm install
cd ../calculator && npm install
cd ../database && npm install
cd ../weather && npm install
cd ../webscraper && npm install
```

Or install individually as needed.

## Testing Your Setup

After importing and installing dependencies:

1. **Check Server Status**: In SpeakMCP MCP Tools, verify all servers show "Connected"
2. **Test with Voice Commands**:
   - "Create a file called test.txt with hello world"
   - "Calculate 2 plus 2"
   - "Show me all tables in the database"

## Troubleshooting

### Server Shows "Disconnected"
- Check that Node.js is installed (`node --version`)
- Verify dependencies are installed (`npm install` in server directory)
- Check server logs in SpeakMCP for error details

### Weather Server Not Working
- Verify API key is set correctly
- Check that API key is valid at OpenWeatherMap
- Ensure no extra spaces in the API key

### Permission Errors
- Make sure SpeakMCP has permission to execute Node.js
- On macOS/Linux, verify file permissions are correct

## Customization

You can modify these configurations:
- Change server names
- Add environment variables
- Enable/disable specific servers
- Adjust paths if examples are in different locations

## Next Steps

After successfully importing and testing:
1. Explore individual server READMEs for detailed usage
2. Try the voice commands listed in the main examples README
3. Consider building your own MCP server using these as templates

## Support

If you encounter issues:
1. Check the individual server README files
2. Verify all prerequisites are met
3. Check SpeakMCP logs for detailed error messages
4. Ensure all file paths are correct for your system
