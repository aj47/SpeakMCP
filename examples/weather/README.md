# Weather MCP Server Example

A weather information MCP server that provides current weather, forecasts, and city search functionality using the OpenWeatherMap API.

## Features

- **Current Weather**: Get real-time weather for any city
- **5-Day Forecast**: Extended weather predictions
- **Coordinate-based Weather**: Weather by latitude/longitude
- **City Search**: Find cities (works without API key)
- **Multiple Units**: Celsius, Fahrenheit, or Kelvin
- **Graceful Degradation**: Helpful error messages when API key is missing

## Available Tools

### `get_current_weather`
Get current weather for a city.

**Parameters:**
- `city` (string): City name (e.g., 'London', 'New York', 'Tokyo')
- `units` (string, optional): Temperature units - "metric" (Celsius), "imperial" (Fahrenheit), "kelvin"

### `get_weather_forecast`
Get 5-day weather forecast for a city.

**Parameters:**
- `city` (string): City name
- `units` (string, optional): Temperature units

### `get_weather_by_coordinates`
Get current weather by latitude and longitude.

**Parameters:**
- `lat` (number): Latitude
- `lon` (number): Longitude
- `units` (string, optional): Temperature units

### `search_cities`
Search for cities by name (works without API key).

**Parameters:**
- `query` (string): City name to search for

## Setup Instructions

1. **Get a free API key:**
   - Visit [OpenWeatherMap](https://openweathermap.org/api)
   - Sign up for a free account
   - Get your API key from the dashboard

2. **Install dependencies:**
   ```bash
   cd examples/weather
   npm install
   ```

3. **Set environment variable:**
   ```bash
   export OPENWEATHER_API_KEY="your-api-key-here"
   ```

4. **Test the server:**
   ```bash
   npm start
   ```

5. **Configure in SpeakMCP:**
   Add this configuration to your MCP servers:
   ```json
   {
     "weather-example": {
       "command": "node",
       "args": ["examples/weather/index.js"],
       "env": {
         "OPENWEATHER_API_KEY": "your-api-key-here"
       }
     }
   }
   ```

## Usage Examples

Once configured in SpeakMCP, you can use voice commands like:

- "What's the weather in London?"
- "Get the 5-day forecast for New York"
- "What's the weather at coordinates 40.7128, -74.0060?"
- "Search for cities named Paris"
- "Get weather in Tokyo in Fahrenheit"

## API Key Management

### With API Key
- Full functionality including current weather and forecasts
- Real-time data from OpenWeatherMap
- Support for any city worldwide

### Without API Key
- City search functionality still works
- Helpful error messages explaining how to get an API key
- No weather data retrieval

## Sample Output

### Current Weather
```
🌤️ Weather in London, GB

🌡️ Temperature: 15°C (feels like 13°C)
📝 Conditions: partly cloudy
💧 Humidity: 72%
🌬️ Wind: 3.2 m/s
📊 Pressure: 1013 hPa
```

### 5-Day Forecast
```
📅 5-Day Weather Forecast for New York, US

📆 Mon Dec 04 2023
   🌡️ 8°C - light rain

📆 Tue Dec 05 2023
   🌡️ 12°C - clear sky

📆 Wed Dec 06 2023
   🌡️ 6°C - snow
```

## Error Handling

- **Missing API Key**: Clear instructions on how to obtain one
- **Invalid City**: Suggestions for correct city names
- **Network Issues**: Graceful error messages
- **API Limits**: Information about rate limiting

## Free API Limits

OpenWeatherMap free tier includes:
- 1,000 API calls per day
- Current weather data
- 5-day forecast
- No credit card required

## Supported Units

- **metric**: Celsius, m/s wind speed
- **imperial**: Fahrenheit, mph wind speed  
- **kelvin**: Kelvin, m/s wind speed
