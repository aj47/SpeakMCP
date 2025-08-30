#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

class CalculatorServer {
  constructor() {
    this.server = new Server(
      {
        name: "calculator-example",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "calculate",
            description: "Evaluate a mathematical expression safely",
            inputSchema: {
              type: "object",
              properties: {
                expression: {
                  type: "string",
                  description: "Mathematical expression to evaluate (e.g., '2 + 3 * 4')",
                },
              },
              required: ["expression"],
            },
          },
          {
            name: "basic_math",
            description: "Perform basic arithmetic operations",
            inputSchema: {
              type: "object",
              properties: {
                operation: {
                  type: "string",
                  enum: ["add", "subtract", "multiply", "divide", "power", "modulo"],
                  description: "Type of operation to perform",
                },
                a: {
                  type: "number",
                  description: "First number",
                },
                b: {
                  type: "number",
                  description: "Second number",
                },
              },
              required: ["operation", "a", "b"],
            },
          },
          {
            name: "advanced_math",
            description: "Perform advanced mathematical functions",
            inputSchema: {
              type: "object",
              properties: {
                function: {
                  type: "string",
                  enum: ["sin", "cos", "tan", "log", "ln", "sqrt", "abs", "ceil", "floor", "round"],
                  description: "Mathematical function to apply",
                },
                value: {
                  type: "number",
                  description: "Input value for the function",
                },
              },
              required: ["function", "value"],
            },
          },
          {
            name: "statistics",
            description: "Calculate statistical measures for a list of numbers",
            inputSchema: {
              type: "object",
              properties: {
                numbers: {
                  type: "array",
                  items: { type: "number" },
                  description: "Array of numbers to analyze",
                },
                operation: {
                  type: "string",
                  enum: ["mean", "median", "mode", "sum", "min", "max", "range", "variance", "stddev"],
                  description: "Statistical operation to perform",
                },
              },
              required: ["numbers", "operation"],
            },
          },
          {
            name: "convert_units",
            description: "Convert between different units",
            inputSchema: {
              type: "object",
              properties: {
                value: {
                  type: "number",
                  description: "Value to convert",
                },
                from_unit: {
                  type: "string",
                  enum: ["celsius", "fahrenheit", "kelvin", "meters", "feet", "inches", "kilometers", "miles"],
                  description: "Unit to convert from",
                },
                to_unit: {
                  type: "string",
                  enum: ["celsius", "fahrenheit", "kelvin", "meters", "feet", "inches", "kilometers", "miles"],
                  description: "Unit to convert to",
                },
              },
              required: ["value", "from_unit", "to_unit"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "calculate":
            return await this.calculate(args.expression);
          case "basic_math":
            return await this.basicMath(args.operation, args.a, args.b);
          case "advanced_math":
            return await this.advancedMath(args.function, args.value);
          case "statistics":
            return await this.statistics(args.numbers, args.operation);
          case "convert_units":
            return await this.convertUnits(args.value, args.from_unit, args.to_unit);
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

  // Safe expression evaluator (only allows basic math operations)
  async calculate(expression) {
    // Remove whitespace and validate expression
    const cleanExpr = expression.replace(/\s/g, '');
    
    // Only allow numbers, basic operators, parentheses, and decimal points
    if (!/^[0-9+\-*/().]+$/.test(cleanExpr)) {
      throw new Error("Invalid characters in expression. Only numbers and basic operators (+, -, *, /, parentheses) are allowed.");
    }

    try {
      // Use Function constructor for safe evaluation (no access to global scope)
      const result = Function(`"use strict"; return (${cleanExpr})`)();
      
      if (!isFinite(result)) {
        throw new Error("Result is not a finite number");
      }

      return {
        content: [
          {
            type: "text",
            text: `${expression} = ${result}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Invalid expression: ${error.message}`);
    }
  }

  async basicMath(operation, a, b) {
    let result;
    
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) throw new Error("Division by zero");
        result = a / b;
        break;
      case "power":
        result = Math.pow(a, b);
        break;
      case "modulo":
        if (b === 0) throw new Error("Modulo by zero");
        result = a % b;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `${a} ${operation} ${b} = ${result}`,
        },
      ],
    };
  }

  async advancedMath(func, value) {
    let result;
    
    switch (func) {
      case "sin":
        result = Math.sin(value);
        break;
      case "cos":
        result = Math.cos(value);
        break;
      case "tan":
        result = Math.tan(value);
        break;
      case "log":
        if (value <= 0) throw new Error("Logarithm of non-positive number");
        result = Math.log10(value);
        break;
      case "ln":
        if (value <= 0) throw new Error("Natural logarithm of non-positive number");
        result = Math.log(value);
        break;
      case "sqrt":
        if (value < 0) throw new Error("Square root of negative number");
        result = Math.sqrt(value);
        break;
      case "abs":
        result = Math.abs(value);
        break;
      case "ceil":
        result = Math.ceil(value);
        break;
      case "floor":
        result = Math.floor(value);
        break;
      case "round":
        result = Math.round(value);
        break;
      default:
        throw new Error(`Unknown function: ${func}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `${func}(${value}) = ${result}`,
        },
      ],
    };
  }

  async statistics(numbers, operation) {
    if (numbers.length === 0) {
      throw new Error("Cannot perform statistics on empty array");
    }

    let result;
    const sorted = [...numbers].sort((a, b) => a - b);
    
    switch (operation) {
      case "mean":
        result = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
        break;
      case "median":
        const mid = Math.floor(numbers.length / 2);
        result = numbers.length % 2 === 0 
          ? (sorted[mid - 1] + sorted[mid]) / 2 
          : sorted[mid];
        break;
      case "mode":
        const freq = {};
        numbers.forEach(n => freq[n] = (freq[n] || 0) + 1);
        const maxFreq = Math.max(...Object.values(freq));
        const modes = Object.keys(freq).filter(k => freq[k] === maxFreq);
        result = modes.length === numbers.length ? "No mode" : modes.join(", ");
        break;
      case "sum":
        result = numbers.reduce((sum, n) => sum + n, 0);
        break;
      case "min":
        result = Math.min(...numbers);
        break;
      case "max":
        result = Math.max(...numbers);
        break;
      case "range":
        result = Math.max(...numbers) - Math.min(...numbers);
        break;
      case "variance":
        const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
        result = numbers.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / numbers.length;
        break;
      case "stddev":
        const meanStd = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
        const variance = numbers.reduce((sum, n) => sum + Math.pow(n - meanStd, 2), 0) / numbers.length;
        result = Math.sqrt(variance);
        break;
      default:
        throw new Error(`Unknown statistical operation: ${operation}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `${operation} of [${numbers.join(", ")}] = ${result}`,
        },
      ],
    };
  }

  async convertUnits(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) {
      return {
        content: [
          {
            type: "text",
            text: `${value} ${fromUnit} = ${value} ${toUnit} (no conversion needed)`,
          },
        ],
      };
    }

    let result;

    // Temperature conversions
    if (["celsius", "fahrenheit", "kelvin"].includes(fromUnit) && 
        ["celsius", "fahrenheit", "kelvin"].includes(toUnit)) {
      result = this.convertTemperature(value, fromUnit, toUnit);
    }
    // Length conversions
    else if (["meters", "feet", "inches", "kilometers", "miles"].includes(fromUnit) && 
             ["meters", "feet", "inches", "kilometers", "miles"].includes(toUnit)) {
      result = this.convertLength(value, fromUnit, toUnit);
    }
    else {
      throw new Error(`Cannot convert from ${fromUnit} to ${toUnit}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `${value} ${fromUnit} = ${result} ${toUnit}`,
        },
      ],
    };
  }

  convertTemperature(value, from, to) {
    // Convert to Celsius first
    let celsius;
    switch (from) {
      case "celsius":
        celsius = value;
        break;
      case "fahrenheit":
        celsius = (value - 32) * 5/9;
        break;
      case "kelvin":
        celsius = value - 273.15;
        break;
    }

    // Convert from Celsius to target
    switch (to) {
      case "celsius":
        return celsius;
      case "fahrenheit":
        return celsius * 9/5 + 32;
      case "kelvin":
        return celsius + 273.15;
    }
  }

  convertLength(value, from, to) {
    // Convert to meters first
    let meters;
    switch (from) {
      case "meters":
        meters = value;
        break;
      case "feet":
        meters = value * 0.3048;
        break;
      case "inches":
        meters = value * 0.0254;
        break;
      case "kilometers":
        meters = value * 1000;
        break;
      case "miles":
        meters = value * 1609.34;
        break;
    }

    // Convert from meters to target
    switch (to) {
      case "meters":
        return meters;
      case "feet":
        return meters / 0.3048;
      case "inches":
        return meters / 0.0254;
      case "kilometers":
        return meters / 1000;
      case "miles":
        return meters / 1609.34;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Calculator MCP server running on stdio");
  }
}

const server = new CalculatorServer();
server.run().catch(console.error);
