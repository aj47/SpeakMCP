# Calculator MCP Server Example

A comprehensive MCP server that provides mathematical calculation capabilities including basic arithmetic, advanced functions, statistics, and unit conversions.

## Features

- **Safe Expression Evaluation**: Evaluate mathematical expressions securely
- **Basic Arithmetic**: Add, subtract, multiply, divide, power, modulo
- **Advanced Functions**: Trigonometric, logarithmic, and other mathematical functions
- **Statistics**: Mean, median, mode, variance, standard deviation, and more
- **Unit Conversions**: Temperature and length unit conversions
- **No External Dependencies**: Pure JavaScript implementation

## Available Tools

### `calculate`
Evaluate a mathematical expression safely.

**Parameters:**
- `expression` (string): Mathematical expression (e.g., "2 + 3 * 4", "(10 + 5) / 3")

### `basic_math`
Perform basic arithmetic operations.

**Parameters:**
- `operation` (string): One of "add", "subtract", "multiply", "divide", "power", "modulo"
- `a` (number): First number
- `b` (number): Second number

### `advanced_math`
Perform advanced mathematical functions.

**Parameters:**
- `function` (string): One of "sin", "cos", "tan", "log", "ln", "sqrt", "abs", "ceil", "floor", "round"
- `value` (number): Input value for the function

### `statistics`
Calculate statistical measures for a list of numbers.

**Parameters:**
- `numbers` (array): Array of numbers to analyze
- `operation` (string): One of "mean", "median", "mode", "sum", "min", "max", "range", "variance", "stddev"

### `convert_units`
Convert between different units.

**Parameters:**
- `value` (number): Value to convert
- `from_unit` (string): Unit to convert from
- `to_unit` (string): Unit to convert to

**Supported Units:**
- Temperature: "celsius", "fahrenheit", "kelvin"
- Length: "meters", "feet", "inches", "kilometers", "miles"

## Setup Instructions

1. **Install dependencies:**
   ```bash
   cd examples/calculator
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
     "calculator-example": {
       "command": "node",
       "args": ["examples/calculator/index.js"],
       "env": {}
     }
   }
   ```

## Usage Examples

Once configured in SpeakMCP, you can use voice commands like:

- "Calculate 2 plus 3 times 4"
- "What's the square root of 144?"
- "Convert 100 fahrenheit to celsius"
- "Find the mean of the numbers 1, 2, 3, 4, 5"
- "What's 2 to the power of 8?"
- "Calculate the sine of 1.57"

## Security Features

- Expression evaluation is sandboxed and only allows basic mathematical operations
- No access to system functions or variables
- Input validation prevents code injection
- Error handling for edge cases (division by zero, invalid inputs, etc.)

## Supported Operations

### Basic Math
- Addition, subtraction, multiplication, division
- Exponentiation (power)
- Modulo operations

### Advanced Functions
- Trigonometric: sin, cos, tan
- Logarithmic: log (base 10), ln (natural log)
- Other: sqrt, abs, ceil, floor, round

### Statistics
- Central tendency: mean, median, mode
- Spread: range, variance, standard deviation
- Aggregation: sum, min, max

### Unit Conversions
- Temperature: Celsius ↔ Fahrenheit ↔ Kelvin
- Length: Meters ↔ Feet ↔ Inches ↔ Kilometers ↔ Miles
