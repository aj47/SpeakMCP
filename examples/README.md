# SpeakMCP Example MCP Servers

This directory contains example MCP (Model Context Protocol) servers that can be run locally with SpeakMCP. These examples demonstrate different MCP capabilities and provide a foundation for building your own MCP servers.

## 🚀 Quick Start

1. **Choose an example server** from the list below
2. **Navigate to its directory** (e.g., `cd examples/filesystem`)
3. **Install dependencies** with `npm install`
4. **Configure in SpeakMCP** using the provided configuration
5. **Start using voice commands** to interact with the server

## 📁 Available Examples

### 🗂️ [Filesystem Server](./filesystem/)
**Safe file operations within a sandboxed directory**

- ✅ **No external dependencies** - Works completely offline
- 🔒 **Secure** - All operations restricted to sandbox directory
- 📝 **Features**: Read, write, delete files; create directories; list contents

**Use cases**: File management, note-taking, document organization

### 🧮 [Calculator Server](./calculator/)
**Comprehensive mathematical computation tools**

- ✅ **No external dependencies** - Pure JavaScript implementation
- 🔢 **Features**: Basic arithmetic, advanced functions, statistics, unit conversions
- 🛡️ **Safe**: Expression evaluation with security validation

**Use cases**: Mathematical calculations, data analysis, unit conversions

### 🗄️ [Database Server](./database/)
**SQLite database operations and management**

- ✅ **Local database** - No external database required
- 📊 **Features**: CRUD operations, table management, sample data included
- 🔒 **Secure**: SQL validation prevents dangerous operations

**Use cases**: Data storage, querying, simple database management

### 🌤️ [Weather Server](./weather/)
**Real-time weather information and forecasts**

- 🌐 **API-based** - Uses OpenWeatherMap API (free tier available)
- 📅 **Features**: Current weather, 5-day forecasts, coordinate-based lookup
- 🔍 **Fallback**: City search works without API key

**Use cases**: Weather checking, travel planning, location-based information

### 🕷️ [Web Scraper Server](./webscraper/)
**Web content extraction and analysis**

- ✅ **No external APIs** - Direct web scraping
- 🛡️ **Rate limited** - Respects target websites
- 📄 **Features**: Text extraction, link/image extraction, metadata, content search

**Use cases**: Research, content analysis, link discovery

## 🔧 Installation & Setup

### Prerequisites
- Node.js 18+ installed
- SpeakMCP application running

### General Setup Process

1. **Navigate to example directory:**
   ```bash
   cd examples/[server-name]
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Test the server (optional):**
   ```bash
   npm start
   ```

4. **Configure in SpeakMCP:**
   - Open SpeakMCP settings
   - Go to "MCP Tools" section
   - Add server configuration (see individual READMEs)

## 📋 Configuration Examples

### Quick Configuration (Copy & Paste)

Add these to your SpeakMCP MCP servers configuration:

```json
{
  "mcpServers": {
    "filesystem-example": {
      "command": "node",
      "args": ["examples/filesystem/index.js"]
    },
    "calculator-example": {
      "command": "node",
      "args": ["examples/calculator/index.js"]
    },
    "database-example": {
      "command": "node",
      "args": ["examples/database/index.js"]
    },
    "weather-example": {
      "command": "node",
      "args": ["examples/weather/index.js"],
      "env": {
        "OPENWEATHER_API_KEY": "your-api-key-here"
      }
    },
    "webscraper-example": {
      "command": "node",
      "args": ["examples/webscraper/index.js"]
    }
  }
}
```

### Individual Server Configurations

Each server can be configured independently. See individual README files for detailed setup instructions and environment variables.

## 🎯 Usage Examples

Once configured, you can use voice commands like:

### Filesystem
- "Create a file called notes.txt with my meeting notes"
- "Read the contents of the project plan file"
- "List all files in the documents folder"

### Calculator
- "Calculate 15 percent of 250"
- "What's the square root of 144?"
- "Convert 100 fahrenheit to celsius"

### Database
- "Show me all users in the database"
- "Create a new task for user John"
- "Find all incomplete tasks"

### Weather
- "What's the weather in London?"
- "Get the 5-day forecast for New York"
- "Check weather at coordinates 40.7, -74.0"

### Web Scraper
- "Extract text from https://example.com"
- "Get all links from the homepage"
- "Search for 'AI' on the tech blog"

## 🛠️ Development

### Creating Your Own MCP Server

Use these examples as templates for your own MCP servers:

1. **Copy an existing example** that's closest to your needs
2. **Modify the tools and functionality** for your use case
3. **Update package.json** with your server details
4. **Test thoroughly** before deploying

### Key Components

Each MCP server includes:
- **package.json**: Dependencies and metadata
- **index.js**: Main server implementation
- **README.md**: Setup and usage instructions

### Best Practices

- ✅ **Validate inputs** to prevent security issues
- ✅ **Handle errors gracefully** with helpful messages
- ✅ **Include comprehensive documentation**
- ✅ **Test with various input scenarios**
- ✅ **Follow rate limiting for external APIs**

## 🔒 Security Considerations

- **Filesystem**: Operations restricted to sandbox directory
- **Calculator**: Expression evaluation is sandboxed
- **Database**: SQL validation prevents dangerous operations
- **Weather**: API key should be kept secure
- **Web Scraper**: Rate limiting prevents abuse

## 📚 Additional Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [SpeakMCP Documentation](../README.md)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)

## 🤝 Contributing

Found an issue or want to improve an example?
1. Fork the repository
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## 📄 License

These examples are provided under the same license as SpeakMCP. See the main LICENSE file for details.
