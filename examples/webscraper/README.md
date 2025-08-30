# Web Scraper MCP Server Example

A web scraping MCP server that can fetch and parse web content with proper rate limiting, error handling, and content extraction capabilities.

## Features

- **Safe Web Scraping**: Rate limiting and timeout protection
- **Content Extraction**: Text, links, images, and metadata
- **Search Functionality**: Find specific content within pages
- **Error Handling**: Graceful handling of network issues and invalid URLs
- **Rate Limiting**: 10 requests per minute per domain
- **Security**: Only HTTP/HTTPS URLs allowed

## Available Tools

### `fetch_webpage`
Fetch and return the raw HTML content of a webpage.

**Parameters:**
- `url` (string): URL of the webpage to fetch
- `timeout` (number, optional): Request timeout in milliseconds (default: 10000)

### `extract_text`
Extract clean text content from a webpage.

**Parameters:**
- `url` (string): URL of the webpage to extract text from
- `max_length` (number, optional): Maximum length of extracted text (default: 5000)

### `extract_links`
Extract all links from a webpage.

**Parameters:**
- `url` (string): URL of the webpage to extract links from
- `filter_domain` (string, optional): Only return links from this domain

### `extract_images`
Extract image URLs from a webpage.

**Parameters:**
- `url` (string): URL of the webpage to extract images from
- `min_size` (number, optional): Minimum image size in pixels (default: 100)

### `extract_metadata`
Extract page metadata (title, description, Open Graph tags, etc.).

**Parameters:**
- `url` (string): URL of the webpage to extract metadata from

### `search_content`
Search for specific content within a webpage.

**Parameters:**
- `url` (string): URL of the webpage to search
- `query` (string): Text to search for
- `case_sensitive` (boolean, optional): Whether search should be case sensitive (default: false)

## Setup Instructions

1. **Install dependencies:**
   ```bash
   cd examples/webscraper
   npm install
   ```

2. **Test the server:**
   ```bash
   npm start
   ```

3. **Configure in SpeakMCP:**
   Add this configuration to your MCP servers:
   ```json
   {
     "webscraper-example": {
       "command": "node",
       "args": ["examples/webscraper/index.js"],
       "env": {}
     }
   }
   ```

## Usage Examples

Once configured in SpeakMCP, you can use voice commands like:

- "Fetch the webpage content from https://example.com"
- "Extract text from https://news.example.com"
- "Get all links from https://example.com"
- "Find all images on https://gallery.example.com"
- "Extract metadata from https://article.example.com"
- "Search for 'artificial intelligence' on https://tech.example.com"

## Rate Limiting

- **10 requests per minute** per domain
- Automatic rate limit tracking
- Clear error messages when limits are exceeded
- Prevents overwhelming target websites

## Security Features

- **URL Validation**: Only HTTP and HTTPS URLs allowed
- **Timeout Protection**: Configurable request timeouts
- **Content Filtering**: Removes scripts and styles from text extraction
- **Error Handling**: Safe handling of malformed HTML and network errors

## Content Extraction Features

### Text Extraction
- Removes navigation, scripts, and styling elements
- Cleans up whitespace and formatting
- Configurable maximum length
- Preserves readable content structure

### Link Extraction
- Converts relative URLs to absolute URLs
- Optional domain filtering
- Includes link text and destination
- Handles malformed links gracefully

### Image Extraction
- Converts relative URLs to absolute URLs
- Size filtering capabilities
- Includes alt text and dimensions
- Handles missing attributes

### Metadata Extraction
- Page title and description
- Author and keywords
- Open Graph tags (og:title, og:description, og:image)
- SEO-relevant metadata

### Content Search
- Case-sensitive and case-insensitive search
- Context around matches (50 characters before/after)
- Multiple match support (up to 10 results)
- Position tracking within content

## Error Handling

- **Network Errors**: Timeout and connection issues
- **Invalid URLs**: Malformed or unsupported protocols
- **HTTP Errors**: 404, 500, and other status codes
- **Rate Limiting**: Clear messages about request limits
- **Parsing Errors**: Graceful handling of malformed HTML

## Best Practices

- Respect robots.txt files (manual checking recommended)
- Use appropriate delays between requests
- Be mindful of website terms of service
- Consider using APIs when available instead of scraping
- Cache results when appropriate to reduce requests

## Limitations

- JavaScript-rendered content not supported (static HTML only)
- No support for authentication or cookies
- Rate limiting is per-server-instance, not global
- Large pages may be truncated for performance
