/**
 * Example: Dynamic Tool Management for AI Agents
 * 
 * This example demonstrates how an AI agent can use the dynamic tool management
 * system to discover, control, and manage MCP tools during runtime.
 */

interface ToolCallResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
}

// Mock function representing tool execution (replace with actual implementation)
async function executeToolCall(toolCall: { name: string; arguments: any }): Promise<ToolCallResult> {
  // This would be replaced with actual MCP tool execution
  console.log(`Executing tool: ${toolCall.name}`, toolCall.arguments)
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true }) }],
    isError: false
  }
}

/**
 * Agent class demonstrating dynamic tool management capabilities
 */
class SmartAgent {
  private availableTools: any[] = []
  private disabledTools: Set<string> = new Set()

  /**
   * Initialize the agent by discovering available tools
   */
  async initialize(): Promise<void> {
    console.log("🤖 Initializing Smart Agent...")
    
    try {
      // Discover all available tools
      const toolsResponse = await executeToolCall({
        name: "tool_manager:list_tools",
        arguments: { includeDisabled: true }
      })

      const toolsData = JSON.parse(toolsResponse.content[0].text)
      this.availableTools = toolsData.tools
      
      console.log(`📋 Discovered ${toolsData.totalTools} tools:`)
      console.log(`  ✅ Enabled: ${toolsData.enabledTools}`)
      console.log(`  ❌ Disabled: ${toolsData.disabledTools}`)
      
      // Log some interesting tools
      const interestingTools = this.availableTools
        .filter(tool => !tool.name.startsWith("tool_manager:"))
        .slice(0, 5)
      
      if (interestingTools.length > 0) {
        console.log("\n🔧 Available tools:")
        interestingTools.forEach(tool => {
          const status = tool.enabled ? "✅" : "❌"
          console.log(`  ${status} ${tool.name}: ${tool.description}`)
        })
      }
    } catch (error) {
      console.error("❌ Failed to initialize agent:", error)
    }
  }

  /**
   * Perform a sensitive operation that requires disabling certain tools
   */
  async performSensitiveOperation(): Promise<void> {
    console.log("\n🔒 Starting sensitive operation...")
    
    // Tools that should be disabled during sensitive operations
    const riskyTools = [
      "filesystem:write_file",
      "filesystem:delete_file", 
      "web:fetch_url",
      "system:execute_command"
    ]

    const disabledTools: string[] = []

    // Disable risky tools temporarily
    for (const toolName of riskyTools) {
      const tool = this.availableTools.find(t => t.name === toolName)
      if (!tool) continue

      // Check if we can disable this tool
      const permissionsResponse = await executeToolCall({
        name: "tool_manager:get_tool_permissions",
        arguments: { toolName }
      })

      const permissions = JSON.parse(permissionsResponse.content[0].text)
      
      if (permissions.permissions.canBeDisabledByAgent) {
        console.log(`🚫 Temporarily disabling ${toolName}...`)
        
        const disableResponse = await executeToolCall({
          name: "tool_manager:disable_tool",
          arguments: {
            toolName,
            reason: "Disabled during sensitive operation for safety",
            duration: 10 * 60 * 1000 // 10 minutes
          }
        })

        const result = JSON.parse(disableResponse.content[0].text)
        if (result.success) {
          disabledTools.push(toolName)
          console.log(`  ✅ ${toolName} disabled successfully`)
        } else {
          console.log(`  ❌ Failed to disable ${toolName}: ${result.error}`)
        }
      } else {
        console.log(`  ⚠️  Cannot disable ${toolName}: insufficient permissions`)
      }
    }

    // Simulate the sensitive operation
    console.log("\n⚡ Performing sensitive data processing...")
    await new Promise(resolve => setTimeout(resolve, 2000))
    console.log("✅ Sensitive operation completed successfully")

    // Re-enable tools that were disabled
    console.log("\n🔓 Re-enabling tools...")
    for (const toolName of disabledTools) {
      const enableResponse = await executeToolCall({
        name: "tool_manager:enable_tool",
        arguments: {
          toolName,
          reason: "Re-enabling after sensitive operation completed"
        }
      })

      const result = JSON.parse(enableResponse.content[0].text)
      if (result.success) {
        console.log(`  ✅ ${toolName} re-enabled`)
      } else {
        console.log(`  ❌ Failed to re-enable ${toolName}: ${result.error}`)
      }
    }
  }

  /**
   * Analyze tool usage patterns and optimize tool availability
   */
  async optimizeToolUsage(): Promise<void> {
    console.log("\n📊 Analyzing tool usage patterns...")

    const toolUsageData: Array<{
      name: string
      totalCalls: number
      successRate: number
      avgExecutionTime: number
    }> = []

    // Get usage stats for all tools
    for (const tool of this.availableTools) {
      if (tool.name.startsWith("tool_manager:")) continue

      try {
        const statsResponse = await executeToolCall({
          name: "tool_manager:get_tool_usage_stats",
          arguments: { toolName: tool.name }
        })

        const stats = JSON.parse(statsResponse.content[0].text)
        const usageStats = stats.usageStats

        if (usageStats.totalCalls > 0) {
          toolUsageData.push({
            name: tool.name,
            totalCalls: usageStats.totalCalls,
            successRate: (usageStats.successfulCalls / usageStats.totalCalls) * 100,
            avgExecutionTime: usageStats.averageExecutionTime
          })
        }
      } catch (error) {
        console.log(`  ⚠️  Could not get stats for ${tool.name}`)
      }
    }

    // Sort by usage frequency
    toolUsageData.sort((a, b) => b.totalCalls - a.totalCalls)

    console.log("\n📈 Tool Usage Report:")
    console.log("Top 5 most used tools:")
    toolUsageData.slice(0, 5).forEach((tool, index) => {
      console.log(`  ${index + 1}. ${tool.name}`)
      console.log(`     Calls: ${tool.totalCalls}, Success: ${tool.successRate.toFixed(1)}%, Avg Time: ${tool.avgExecutionTime}ms`)
    })

    // Identify problematic tools (low success rate)
    const problematicTools = toolUsageData.filter(tool => 
      tool.successRate < 80 && tool.totalCalls > 5
    )

    if (problematicTools.length > 0) {
      console.log("\n⚠️  Tools with low success rates:")
      problematicTools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.successRate.toFixed(1)}% success rate`)
      })

      // Optionally disable problematic tools
      console.log("\n🤔 Consider temporarily disabling problematic tools for investigation")
    }

    // Identify unused tools
    const unusedTools = this.availableTools.filter(tool => 
      !tool.name.startsWith("tool_manager:") && 
      !toolUsageData.some(usage => usage.name === tool.name)
    )

    if (unusedTools.length > 0) {
      console.log(`\n💤 Found ${unusedTools.length} unused tools that could be disabled to reduce clutter`)
    }
  }

  /**
   * Demonstrate adaptive tool management based on context
   */
  async adaptiveToolManagement(context: "development" | "production" | "testing"): Promise<void> {
    console.log(`\n🎯 Adapting tools for ${context} context...`)

    const toolPolicies = {
      development: {
        allowRiskyTools: true,
        enableDebugTools: true,
        restrictNetworkAccess: false
      },
      production: {
        allowRiskyTools: false,
        enableDebugTools: false,
        restrictNetworkAccess: true
      },
      testing: {
        allowRiskyTools: false,
        enableDebugTools: true,
        restrictNetworkAccess: true
      }
    }

    const policy = toolPolicies[context]

    // Disable risky tools in production/testing
    if (!policy.allowRiskyTools) {
      const riskyTools = ["filesystem:delete_file", "system:execute_command"]
      for (const toolName of riskyTools) {
        console.log(`🚫 Disabling risky tool: ${toolName}`)
        await executeToolCall({
          name: "tool_manager:disable_tool",
          arguments: {
            toolName,
            reason: `Disabled in ${context} environment for safety`
          }
        })
      }
    }

    // Restrict network access if needed
    if (policy.restrictNetworkAccess) {
      const networkTools = ["web:fetch_url", "api:make_request"]
      for (const toolName of networkTools) {
        console.log(`🌐 Restricting network tool: ${toolName}`)
        await executeToolCall({
          name: "tool_manager:disable_tool",
          arguments: {
            toolName,
            reason: `Network access restricted in ${context} environment`,
            duration: 60 * 60 * 1000 // 1 hour
          }
        })
      }
    }

    console.log(`✅ Tool configuration adapted for ${context} environment`)
  }
}

/**
 * Main example execution
 */
async function runExample(): Promise<void> {
  console.log("🚀 Dynamic Tool Management Example")
  console.log("=====================================\n")

  const agent = new SmartAgent()

  try {
    // Initialize and discover tools
    await agent.initialize()

    // Demonstrate sensitive operation with tool control
    await agent.performSensitiveOperation()

    // Analyze tool usage patterns
    await agent.optimizeToolUsage()

    // Demonstrate adaptive tool management
    await agent.adaptiveToolManagement("production")

    console.log("\n🎉 Example completed successfully!")
    
  } catch (error) {
    console.error("❌ Example failed:", error)
  }
}

// Export for use in other modules
export { SmartAgent, runExample }

// Run example if this file is executed directly
if (require.main === module) {
  runExample()
}
