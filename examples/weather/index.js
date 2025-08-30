#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

class WeatherServer {
  constructor() {
    this.server = new Server(
      {
        name: "weather-example",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.apiKey = process.env.OPENWEATHER_API_KEY;
    this.baseUrl = "https://api.openweathermap.org/data/2.5";
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_current_weather",
            description: "Get current weather for a city",
            inputSchema: {
              type: "object",
              properties: {
                city: {
                  type: "string",
                  description: "City name (e.g., 'London', 'New York', 'Tokyo')",
                },
                units: {
                  type: "string",
                  enum: ["metric", "imperial", "kelvin"],
                  description: "Temperature units (metric=Celsius, imperial=Fahrenheit, kelvin=Kelvin)",
                  default: "metric",
                },
              },
              required: ["city"],
            },
          },
          {
            name: "get_weather_forecast",
            description: "Get 5-day weather forecast for a city",
            inputSchema: {
              type: "object",
              properties: {
                city: {
                  type: "string",
                  description: "City name (e.g., 'London', 'New York', 'Tokyo')",
                },
                units: {
                  type: "string",
                  enum: ["metric", "imperial", "kelvin"],
                  description: "Temperature units (metric=Celsius, imperial=Fahrenheit, kelvin=Kelvin)",
                  default: "metric",
                },
              },
              required: ["city"],
            },
          },
          {
            name: "get_weather_by_coordinates",
            description: "Get current weather by latitude and longitude",
            inputSchema: {
              type: "object",
              properties: {
                lat: {
                  type: "number",
                  description: "Latitude",
                },
                lon: {
                  type: "number",
                  description: "Longitude",
                },
                units: {
                  type: "string",
                  enum: ["metric", "imperial", "kelvin"],
                  description: "Temperature units",
                  default: "metric",
                },
              },
              required: ["lat", "lon"],
            },
          },
          {
            name: "search_cities",
            description: "Search for cities by name (works without API key)",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "City name to search for",
                },
              },
              required: ["query"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "get_current_weather":
            return await this.getCurrentWeather(args.city, args.units || "metric");
          case "get_weather_forecast":
            return await this.getWeatherForecast(args.city, args.units || "metric");
          case "get_weather_by_coordinates":
            return await this.getWeatherByCoordinates(args.lat, args.lon, args.units || "metric");
          case "search_cities":
            return await this.searchCities(args.query);
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

  checkApiKey() {
    if (!this.apiKey) {
      throw new Error(
        "OpenWeather API key not found. Please set OPENWEATHER_API_KEY environment variable. " +
        "Get a free API key at https://openweathermap.org/api"
      );
    }
  }

  async makeApiRequest(endpoint) {
    this.checkApiKey();
    
    const url = `${this.baseUrl}${endpoint}&appid=${this.apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
  }

  formatTemperature(temp, units) {
    const unitSymbol = {
      metric: "°C",
      imperial: "°F",
      kelvin: "K"
    };
    return `${Math.round(temp)}${unitSymbol[units]}`;
  }

  formatWeatherData(data, units) {
    const temp = this.formatTemperature(data.main.temp, units);
    const feelsLike = this.formatTemperature(data.main.feels_like, units);
    const description = data.weather[0].description;
    const humidity = data.main.humidity;
    const pressure = data.main.pressure;
    const windSpeed = data.wind?.speed || 0;
    const windUnit = units === "imperial" ? "mph" : "m/s";

    return `🌤️ Weather in ${data.name}, ${data.sys.country}

🌡️ Temperature: ${temp} (feels like ${feelsLike})
📝 Conditions: ${description}
💧 Humidity: ${humidity}%
🌬️ Wind: ${windSpeed} ${windUnit}
📊 Pressure: ${pressure} hPa`;
  }

  async getCurrentWeather(city, units) {
    const endpoint = `/weather?q=${encodeURIComponent(city)}&units=${units}`;
    const data = await this.makeApiRequest(endpoint);
    
    return {
      content: [
        {
          type: "text",
          text: this.formatWeatherData(data, units),
        },
      ],
    };
  }

  async getWeatherForecast(city, units) {
    const endpoint = `/forecast?q=${encodeURIComponent(city)}&units=${units}`;
    const data = await this.makeApiRequest(endpoint);
    
    // Group forecast by day
    const dailyForecasts = {};
    data.list.forEach(item => {
      const date = new Date(item.dt * 1000).toDateString();
      if (!dailyForecasts[date]) {
        dailyForecasts[date] = [];
      }
      dailyForecasts[date].push(item);
    });

    let forecastText = `📅 5-Day Weather Forecast for ${data.city.name}, ${data.city.country}\n\n`;
    
    Object.entries(dailyForecasts).slice(0, 5).forEach(([date, forecasts]) => {
      const dayForecast = forecasts[0]; // Use first forecast of the day
      const temp = this.formatTemperature(dayForecast.main.temp, units);
      const description = dayForecast.weather[0].description;
      
      forecastText += `📆 ${date}\n`;
      forecastText += `   🌡️ ${temp} - ${description}\n\n`;
    });

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  }

  async getWeatherByCoordinates(lat, lon, units) {
    const endpoint = `/weather?lat=${lat}&lon=${lon}&units=${units}`;
    const data = await this.makeApiRequest(endpoint);
    
    return {
      content: [
        {
          type: "text",
          text: this.formatWeatherData(data, units),
        },
      ],
    };
  }

  // This function works without API key - provides mock city search
  async searchCities(query) {
    // Mock city database for demonstration
    const cities = [
      { name: "London", country: "GB", lat: 51.5074, lon: -0.1278 },
      { name: "New York", country: "US", lat: 40.7128, lon: -74.0060 },
      { name: "Tokyo", country: "JP", lat: 35.6762, lon: 139.6503 },
      { name: "Paris", country: "FR", lat: 48.8566, lon: 2.3522 },
      { name: "Sydney", country: "AU", lat: -33.8688, lon: 151.2093 },
      { name: "Berlin", country: "DE", lat: 52.5200, lon: 13.4050 },
      { name: "Moscow", country: "RU", lat: 55.7558, lon: 37.6176 },
      { name: "Beijing", country: "CN", lat: 39.9042, lon: 116.4074 },
      { name: "Mumbai", country: "IN", lat: 19.0760, lon: 72.8777 },
      { name: "São Paulo", country: "BR", lat: -23.5505, lon: -46.6333 },
    ];

    const matches = cities.filter(city => 
      city.name.toLowerCase().includes(query.toLowerCase())
    );

    if (matches.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No cities found matching "${query}". Try searching for major cities like London, New York, Tokyo, etc.`,
          },
        ],
      };
    }

    const resultText = `🔍 Cities matching "${query}":\n\n` +
      matches.map(city => 
        `📍 ${city.name}, ${city.country} (${city.lat}, ${city.lon})`
      ).join("\n");

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
    console.error("Weather MCP server running on stdio");
  }
}

const server = new WeatherServer();
server.run().catch(console.error);
