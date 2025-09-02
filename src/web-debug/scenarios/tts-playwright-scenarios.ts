/**
 * TTS debugging scenarios using Playwright MCP tools
 * These scenarios demonstrate how to use web debugging mode to test TTS responses
 * with content extracted from web pages using the real Playwright MCP server
 */

import { logger } from '../utils/logger'
import { ttsDebugService } from '../services/tts-debug-service'

export interface TTSScenario {
  id: string
  name: string
  description: string
  mcpToolCalls: MCPToolCall[]
  ttsConfig: TTSConfig
  expectedOutcomes: string[]
}

export interface MCPToolCall {
  tool: string
  arguments: Record<string, any>
  description: string
}

export interface TTSConfig {
  provider: 'openai' | 'groq' | 'gemini'
  voice?: string
  model?: string
  speed?: number
  enablePreprocessing: boolean
  preprocessingOptions?: {
    removeCodeBlocks?: boolean
    removeUrls?: boolean
    convertMarkdown?: boolean
    maxLength?: number
  }
}

export const TTS_PLAYWRIGHT_SCENARIOS: TTSScenario[] = [
  {
    id: 'news-article-tts',
    name: 'News Article TTS Generation',
    description: 'Extract text from a news article and generate TTS audio to test content preprocessing',
    mcpToolCalls: [
      {
        tool: 'playwright:browser_navigate_Playwright',
        arguments: {
          url: 'https://example.com/news/sample-article'
        },
        description: 'Navigate to a sample news article'
      },
      {
        tool: 'playwright:browser_wait_for_Playwright',
        arguments: {
          time: 2
        },
        description: 'Wait for page to load'
      },
      {
        tool: 'playwright:browser_snapshot_Playwright',
        arguments: {},
        description: 'Take accessibility snapshot to extract text content'
      },
      {
        tool: 'playwright:browser_take_screenshot_Playwright',
        arguments: {
          filename: 'news-article-debug.png'
        },
        description: 'Take screenshot for debugging reference'
      }
    ],
    ttsConfig: {
      provider: 'openai',
      voice: 'alloy',
      model: 'tts-1',
      speed: 1.0,
      enablePreprocessing: true,
      preprocessingOptions: {
        removeCodeBlocks: true,
        removeUrls: true,
        convertMarkdown: true,
        maxLength: 4000
      }
    },
    expectedOutcomes: [
      'Article text should be extracted successfully',
      'Text preprocessing should remove URLs and formatting',
      'TTS audio should be generated without errors',
      'Audio duration should be reasonable for text length'
    ]
  },

  {
    id: 'documentation-tts',
    name: 'Technical Documentation TTS',
    description: 'Test TTS generation with technical documentation containing code blocks and markdown',
    mcpToolCalls: [
      {
        tool: 'playwright:browser_navigate_Playwright',
        arguments: {
          url: 'https://docs.github.com/en/get-started/quickstart/hello-world'
        },
        description: 'Navigate to GitHub documentation'
      },
      {
        tool: 'playwright:browser_wait_for_Playwright',
        arguments: {
          time: 3
        },
        description: 'Wait for documentation to load'
      },
      {
        tool: 'playwright:browser_snapshot_Playwright',
        arguments: {},
        description: 'Extract documentation content with code blocks'
      }
    ],
    ttsConfig: {
      provider: 'groq',
      voice: 'Fritz-PlayAI',
      model: 'playai-tts',
      enablePreprocessing: true,
      preprocessingOptions: {
        removeCodeBlocks: true,
        removeUrls: true,
        convertMarkdown: true,
        maxLength: 3000
      }
    },
    expectedOutcomes: [
      'Code blocks should be properly handled in preprocessing',
      'Markdown formatting should be converted to speech-friendly text',
      'Technical terms should be preserved',
      'TTS should handle technical content appropriately'
    ]
  },

  {
    id: 'search-results-tts',
    name: 'Search Results TTS',
    description: 'Extract search results and generate TTS to test handling of mixed content types',
    mcpToolCalls: [
      {
        tool: 'playwright:browser_navigate_Playwright',
        arguments: {
          url: 'https://www.google.com'
        },
        description: 'Navigate to Google search'
      },
      {
        tool: 'playwright:browser_type_Playwright',
        arguments: {
          element: 'search input field',
          ref: 'input[name="q"]',
          text: 'web accessibility best practices'
        },
        description: 'Enter search query'
      },
      {
        tool: 'playwright:browser_press_key_Playwright',
        arguments: {
          key: 'Enter'
        },
        description: 'Submit search'
      },
      {
        tool: 'playwright:browser_wait_for_Playwright',
        arguments: {
          time: 3
        },
        description: 'Wait for search results'
      },
      {
        tool: 'playwright:browser_snapshot_Playwright',
        arguments: {},
        description: 'Extract search result snippets'
      }
    ],
    ttsConfig: {
      provider: 'gemini',
      voice: 'Kore',
      model: 'gemini-2.5-flash-preview-tts',
      enablePreprocessing: true,
      preprocessingOptions: {
        removeUrls: true,
        convertMarkdown: false,
        maxLength: 2000
      }
    },
    expectedOutcomes: [
      'Search results should be extracted from multiple elements',
      'URLs should be removed from snippets',
      'Content should be concatenated appropriately',
      'TTS should handle varied content styles'
    ]
  },

  {
    id: 'form-interaction-tts',
    name: 'Form Interaction with TTS Feedback',
    description: 'Fill out a form and generate TTS for confirmation messages and validation errors',
    mcpToolCalls: [
      {
        tool: 'playwright:browser_navigate_Playwright',
        arguments: {
          url: 'https://httpbin.org/forms/post'
        },
        description: 'Navigate to test form'
      },
      {
        tool: 'playwright:browser_type_Playwright',
        arguments: {
          element: 'customer name field',
          ref: 'input[name="custname"]',
          text: 'Test User'
        },
        description: 'Fill customer name'
      },
      {
        tool: 'playwright:browser_type_Playwright',
        arguments: {
          element: 'phone number field',
          ref: 'input[name="custtel"]',
          text: '555-0123'
        },
        description: 'Fill phone number'
      },
      {
        tool: 'playwright:browser_type_Playwright',
        arguments: {
          element: 'email field',
          ref: 'input[name="custemail"]',
          text: 'test@example.com'
        },
        description: 'Fill email address'
      },
      {
        tool: 'playwright:browser_click_Playwright',
        arguments: {
          element: 'submit button',
          ref: 'input[type="submit"]'
        },
        description: 'Submit form'
      },
      {
        tool: 'playwright:browser_wait_for_Playwright',
        arguments: {
          time: 2
        },
        description: 'Wait for response'
      },
      {
        tool: 'playwright:browser_snapshot_Playwright',
        arguments: {},
        description: 'Extract form submission response'
      }
    ],
    ttsConfig: {
      provider: 'openai',
      voice: 'nova',
      model: 'tts-1-hd',
      speed: 0.9,
      enablePreprocessing: true,
      preprocessingOptions: {
        removeCodeBlocks: false,
        removeUrls: true,
        convertMarkdown: false,
        maxLength: 1000
      }
    },
    expectedOutcomes: [
      'Form should be filled successfully',
      'Response content should be extracted',
      'JSON or structured data should be handled appropriately',
      'TTS should provide clear feedback about form submission'
    ]
  },

  {
    id: 'error-page-tts',
    name: 'Error Page TTS Handling',
    description: 'Test TTS generation with error pages and edge cases',
    mcpToolCalls: [
      {
        tool: 'playwright:browser_navigate_Playwright',
        arguments: {
          url: 'https://httpbin.org/status/404'
        },
        description: 'Navigate to 404 error page'
      },
      {
        tool: 'playwright:browser_wait_for_Playwright',
        arguments: {
          time: 2
        },
        description: 'Wait for error page'
      },
      {
        tool: 'playwright:browser_snapshot_Playwright',
        arguments: {},
        description: 'Extract error page content'
      },
      {
        tool: 'playwright:browser_take_screenshot_Playwright',
        arguments: {
          filename: 'error-page-debug.png'
        },
        description: 'Capture error page screenshot'
      }
    ],
    ttsConfig: {
      provider: 'openai',
      voice: 'echo',
      model: 'tts-1',
      enablePreprocessing: true,
      preprocessingOptions: {
        maxLength: 500
      }
    },
    expectedOutcomes: [
      'Error page content should be extracted',
      'Short error messages should be handled appropriately',
      'TTS should provide clear error communication',
      'Edge cases should not crash the system'
    ]
  }
]

export class TTSPlaywrightScenarioRunner {
  private sessionId: string
  private mcpService: any // Will be injected from WebMCPService

  constructor(sessionId?: string, mcpService?: any) {
    this.sessionId = sessionId || `scenario_${Date.now()}`
    this.mcpService = mcpService
  }

  public setMCPService(mcpService: any): void {
    this.mcpService = mcpService
  }

  public async runScenario(scenarioId: string): Promise<{
    success: boolean
    extractedText?: string
    ttsResponse?: any
    error?: string
    toolResults?: any[]
  }> {
    const scenario = TTS_PLAYWRIGHT_SCENARIOS.find(s => s.id === scenarioId)
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`)
    }

    if (!this.mcpService) {
      throw new Error('MCP service not available. Cannot execute Playwright tools.')
    }

    logger.info('tts', `Starting TTS Playwright scenario: ${scenario.name}`, {
      sessionId: this.sessionId,
      data: { scenarioId, description: scenario.description }
    })

    try {
      // Execute MCP tool calls
      const toolResults = await this.executeMCPToolCalls(scenario.mcpToolCalls)

      // Extract text from tool results (primarily from browser_snapshot_Playwright)
      const extractedText = this.extractTextFromResults(toolResults)

      if (!extractedText) {
        throw new Error('No text was extracted from the web page')
      }

      logger.info('tts', `Text extracted successfully: ${extractedText.length} characters`, {
        sessionId: this.sessionId,
        data: { scenarioId, textLength: extractedText.length }
      })

      // Generate TTS with the extracted text
      const ttsResponse = await ttsDebugService.debugTTSGeneration(
        extractedText,
        scenario.ttsConfig.provider,
        {
          voice: scenario.ttsConfig.voice,
          model: scenario.ttsConfig.model,
          speed: scenario.ttsConfig.speed,
          sessionId: this.sessionId
        }
      )

      // Test preprocessing if enabled
      if (scenario.ttsConfig.enablePreprocessing) {
        const preprocessingResult = ttsDebugService.debugTTSPreprocessing(
          extractedText,
          scenario.ttsConfig.preprocessingOptions,
          this.sessionId
        )

        logger.info('tts-preprocessing', 'Preprocessing completed for scenario', {
          sessionId: this.sessionId,
          data: {
            scenarioId,
            originalLength: preprocessingResult.originalLength,
            processedLength: preprocessingResult.processedLength,
            isValid: preprocessingResult.isValid,
            issues: preprocessingResult.issues
          }
        })
      }

      logger.info('tts', `TTS scenario completed successfully: ${scenario.name}`, {
        sessionId: this.sessionId,
        data: {
          scenarioId,
          success: ttsResponse.success,
          audioSize: ttsResponse.audioSize,
          duration: ttsResponse.duration
        }
      })

      return {
        success: true,
        extractedText,
        ttsResponse,
        toolResults
      }

    } catch (error) {
      logger.error('tts', `TTS scenario failed: ${scenario.name}`, {
        sessionId: this.sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
        data: { scenarioId }
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async executeMCPToolCalls(toolCalls: MCPToolCall[]): Promise<any[]> {
    const results: any[] = []

    for (const toolCall of toolCalls) {
      logger.debug('tts', `Executing MCP tool: ${toolCall.tool}`, {
        sessionId: this.sessionId,
        data: { tool: toolCall.tool, arguments: toolCall.arguments, description: toolCall.description }
      })

      try {
        // Execute the tool call through the MCP service
        const result = await this.mcpService.executeToolCall({
          name: toolCall.tool,
          arguments: toolCall.arguments
        })

        results.push({
          tool: toolCall.tool,
          description: toolCall.description,
          result: result,
          success: !result.isError
        })

        logger.debug('tts', `MCP tool completed: ${toolCall.tool}`, {
          sessionId: this.sessionId,
          data: {
            tool: toolCall.tool,
            success: !result.isError,
            resultType: result.content?.[0]?.type
          }
        })

      } catch (error) {
        logger.error('tts', `MCP tool failed: ${toolCall.tool}`, {
          sessionId: this.sessionId,
          error: error instanceof Error ? error : new Error(String(error)),
          data: { tool: toolCall.tool }
        })

        results.push({
          tool: toolCall.tool,
          description: toolCall.description,
          result: null,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return results
  }

  private extractTextFromResults(toolResults: any[]): string {
    let extractedText = ''

    for (const result of toolResults) {
      if (result.success && result.result?.content) {
        for (const content of result.result.content) {
          if (content.type === 'text') {
            extractedText += content.text + '\n'
          }
        }
      }
    }

    // If no text was extracted from tool results, return a fallback message
    if (!extractedText.trim()) {
      extractedText = 'No text content was extracted from the web page. This may indicate that the page structure has changed or the selectors need to be updated.'
    }

    return extractedText.trim()
  }

  public getAvailableScenarios(): TTSScenario[] {
    return TTS_PLAYWRIGHT_SCENARIOS
  }
}
