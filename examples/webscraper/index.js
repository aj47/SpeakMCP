#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parse } from "node-html-parser";

class WebScraperServer {
  constructor() {
    this.server = new Server(
      {
        name: "webscraper-example",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Rate limiting: track requests per domain
    this.requestCounts = new Map();
    this.rateLimitWindow = 60000; // 1 minute
    this.maxRequestsPerWindow = 10;
    
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "fetch_webpage",
            description: "Fetch and return the raw HTML content of a webpage",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL of the webpage to fetch",
                },
                timeout: {
                  type: "number",
                  description: "Request timeout in milliseconds (default: 10000)",
                  default: 10000,
                },
              },
              required: ["url"],
            },
          },
          {
            name: "extract_text",
            description: "Extract clean text content from a webpage",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL of the webpage to extract text from",
                },
                max_length: {
                  type: "number",
                  description: "Maximum length of extracted text (default: 5000)",
                  default: 5000,
                },
              },
              required: ["url"],
            },
          },
          {
            name: "extract_links",
            description: "Extract all links from a webpage",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL of the webpage to extract links from",
                },
                filter_domain: {
                  type: "string",
                  description: "Only return links from this domain (optional)",
                },
              },
              required: ["url"],
            },
          },
          {
            name: "extract_images",
            description: "Extract image URLs from a webpage",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL of the webpage to extract images from",
                },
                min_size: {
                  type: "number",
                  description: "Minimum image size in pixels (width or height)",
                  default: 100,
                },
              },
              required: ["url"],
            },
          },
          {
            name: "extract_metadata",
            description: "Extract page metadata (title, description, etc.)",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL of the webpage to extract metadata from",
                },
              },
              required: ["url"],
            },
          },
          {
            name: "search_content",
            description: "Search for specific content within a webpage",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL of the webpage to search",
                },
                query: {
                  type: "string",
                  description: "Text to search for",
                },
                case_sensitive: {
                  type: "boolean",
                  description: "Whether search should be case sensitive",
                  default: false,
                },
              },
              required: ["url", "query"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "fetch_webpage":
            return await this.fetchWebpage(args.url, args.timeout || 10000);
          case "extract_text":
            return await this.extractText(args.url, args.max_length || 5000);
          case "extract_links":
            return await this.extractLinks(args.url, args.filter_domain);
          case "extract_images":
            return await this.extractImages(args.url, args.min_size || 100);
          case "extract_metadata":
            return await this.extractMetadata(args.url);
          case "search_content":
            return await this.searchContent(args.url, args.query, args.case_sensitive || false);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // Rate limiting check
  checkRateLimit(url) {
    try {
      const domain = new URL(url).hostname;
      const now = Date.now();
      
      if (!this.requestCounts.has(domain)) {
        this.requestCounts.set(domain, []);
      }
      
      const requests = this.requestCounts.get(domain);
      
      // Remove old requests outside the window
      const validRequests = requests.filter(time => now - time < this.rateLimitWindow);
      
      if (validRequests.length >= this.maxRequestsPerWindow) {
        throw new Error(`Rate limit exceeded for ${domain}. Max ${this.maxRequestsPerWindow} requests per minute.`);
      }
      
      // Add current request
      validRequests.push(now);
      this.requestCounts.set(domain, validRequests);
    } catch (error) {
      if (error.message.includes('Rate limit')) {
        throw error;
      }
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  // Validate URL
  validateUrl(url) {
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are allowed');
      }
      return urlObj;
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  async fetchWithTimeout(url, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SpeakMCP-WebScraper/1.0.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  async fetchWebpage(url, timeout) {
    this.validateUrl(url);
    this.checkRateLimit(url);
    
    const response = await this.fetchWithTimeout(url, timeout);
    const html = await response.text();
    
    return {
      content: [
        {
          type: "text",
          text: `HTML content from ${url}:\n\n${html}`,
        },
      ],
    };
  }

  async extractText(url, maxLength) {
    this.validateUrl(url);
    this.checkRateLimit(url);
    
    const response = await this.fetchWithTimeout(url, 10000);
    const html = await response.text();
    const root = parse(html);
    
    // Remove script and style elements
    root.querySelectorAll('script, style, nav, footer, header').forEach(el => el.remove());
    
    // Extract text content
    let text = root.text;
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    // Truncate if necessary
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }
    
    return {
      content: [
        {
          type: "text",
          text: `Text content from ${url}:\n\n${text}`,
        },
      ],
    };
  }

  async extractLinks(url, filterDomain) {
    this.validateUrl(url);
    this.checkRateLimit(url);
    
    const response = await this.fetchWithTimeout(url, 10000);
    const html = await response.text();
    const root = parse(html);
    
    const links = [];
    const baseUrl = new URL(url);
    
    root.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      const text = link.text.trim();
      
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          
          if (!filterDomain || new URL(absoluteUrl).hostname === filterDomain) {
            links.push({
              url: absoluteUrl,
              text: text || 'No text',
            });
          }
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    const linkText = links.length > 0
      ? links.map(link => `• ${link.text}: ${link.url}`).join('\n')
      : 'No links found';
    
    return {
      content: [
        {
          type: "text",
          text: `Links from ${url}${filterDomain ? ` (filtered by ${filterDomain})` : ''}:\n\n${linkText}`,
        },
      ],
    };
  }

  async extractImages(url, minSize) {
    this.validateUrl(url);
    this.checkRateLimit(url);
    
    const response = await this.fetchWithTimeout(url, 10000);
    const html = await response.text();
    const root = parse(html);
    
    const images = [];
    const baseUrl = new URL(url);
    
    root.querySelectorAll('img[src]').forEach(img => {
      const src = img.getAttribute('src');
      const alt = img.getAttribute('alt') || 'No alt text';
      const width = parseInt(img.getAttribute('width')) || 0;
      const height = parseInt(img.getAttribute('height')) || 0;
      
      if (src && (width >= minSize || height >= minSize || (!width && !height))) {
        try {
          const absoluteUrl = new URL(src, baseUrl).href;
          images.push({
            url: absoluteUrl,
            alt: alt,
            width: width || 'unknown',
            height: height || 'unknown',
          });
        } catch (error) {
          // Skip invalid URLs
        }
      }
    });
    
    const imageText = images.length > 0
      ? images.map(img => `• ${img.alt} (${img.width}x${img.height}): ${img.url}`).join('\n')
      : 'No images found';
    
    return {
      content: [
        {
          type: "text",
          text: `Images from ${url}:\n\n${imageText}`,
        },
      ],
    };
  }

  async extractMetadata(url) {
    this.validateUrl(url);
    this.checkRateLimit(url);
    
    const response = await this.fetchWithTimeout(url, 10000);
    const html = await response.text();
    const root = parse(html);
    
    const metadata = {
      title: root.querySelector('title')?.text || 'No title',
      description: root.querySelector('meta[name="description"]')?.getAttribute('content') || 'No description',
      keywords: root.querySelector('meta[name="keywords"]')?.getAttribute('content') || 'No keywords',
      author: root.querySelector('meta[name="author"]')?.getAttribute('content') || 'No author',
      ogTitle: root.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
      ogDescription: root.querySelector('meta[property="og:description"]')?.getAttribute('content') || '',
      ogImage: root.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
    };
    
    const metadataText = Object.entries(metadata)
      .filter(([key, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    
    return {
      content: [
        {
          type: "text",
          text: `Metadata from ${url}:\n\n${metadataText}`,
        },
      ],
    };
  }

  async searchContent(url, query, caseSensitive) {
    this.validateUrl(url);
    this.checkRateLimit(url);
    
    const response = await this.fetchWithTimeout(url, 10000);
    const html = await response.text();
    const root = parse(html);
    
    // Remove script and style elements
    root.querySelectorAll('script, style').forEach(el => el.remove());
    
    const text = root.text;
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchQuery = caseSensitive ? query : query.toLowerCase();
    
    const matches = [];
    let index = 0;
    
    while ((index = searchText.indexOf(searchQuery, index)) !== -1) {
      const start = Math.max(0, index - 50);
      const end = Math.min(text.length, index + query.length + 50);
      const context = text.substring(start, end);
      
      matches.push({
        position: index,
        context: context.replace(/\s+/g, ' ').trim(),
      });
      
      index += query.length;
      
      // Limit to 10 matches
      if (matches.length >= 10) break;
    }
    
    const resultText = matches.length > 0
      ? `Found ${matches.length} occurrence(s) of "${query}":\n\n` +
        matches.map((match, i) => `${i + 1}. ...${match.context}...`).join('\n\n')
      : `No occurrences of "${query}" found`;
    
    return {
      content: [
        {
          type: "text",
          text: resultText,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Web Scraper MCP server running on stdio");
  }
}

const server = new WebScraperServer();
server.run().catch(console.error);
