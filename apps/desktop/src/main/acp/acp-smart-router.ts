/**
 * ACP Smart Router - Intelligent routing logic for deciding when and how to delegate to ACP agents.
 *
 * This module provides task analysis and agent matching capabilities to help
 * the main AI assistant decide when to delegate work to specialized sub-agents.
 *
 * @example
 * ```typescript
 * import { acpSmartRouter } from './acp-smart-router'
 *
 * // Analyze a task and get routing suggestions
 * const decision = acpSmartRouter.suggestDelegation("Research the latest React 19 features and write a summary")
 * if (decision.shouldDelegate && decision.suggestedAgents?.length) {
 *   console.log(`Delegate to: ${decision.suggestedAgents[0].agentName}`)
 * }
 * ```
 */

import { acpRegistry } from './acp-registry'
import type { ACPAgentDefinition, ACPAgentInstance } from './types'

type ACPAgentForDelegationPrompt = {
  definition: {
    name: ACPAgentDefinition['name']
    displayName?: ACPAgentDefinition['displayName'] | undefined
    description?: ACPAgentDefinition['description'] | undefined
    capabilities: ACPAgentDefinition['capabilities']
  }
}

/**
 * Unified agent representation for delegation
 */
export interface UnifiedAgent {
  /** Agent name/identifier */
  name: string
  /** Human-readable display name */
  displayName: string
  /** Agent description */
  description?: string
  /** List of capabilities/skills */
  capabilities: string[]
  /** Base URL for the agent */
  baseUrl?: string
}

/**
 * Represents the router's decision about whether to delegate a task.
 */
export interface RoutingDecision {
  /** Whether the task should be delegated to a sub-agent */
  shouldDelegate: boolean
  /** Human-readable explanation for the decision */
  reason: string
  /** List of suggested agents if delegation is recommended */
  suggestedAgents?: Array<{
    /** Name of the agent */
    agentName: string
    /** Confidence score from 0 (no match) to 1 (perfect match) */
    confidence: number
    /** Capabilities that matched the task requirements */
    matchedCapabilities: string[]
    /** Suggested task description for this agent */
    suggestedTask?: string
    /** Base URL for the agent */
    baseUrl?: string
  }>
}

/**
 * Analysis of a task's characteristics for routing purposes.
 */
export interface TaskAnalysis {
  /** Categorization of task complexity */
  taskType: 'simple' | 'complex' | 'multi-step'
  /** Estimated complexity score from 1 (trivial) to 10 (very complex) */
  estimatedComplexity: number
  /** List of identified subtasks within the main task */
  identifiedSubtasks: string[]
  /** Capabilities needed to complete this task */
  requiredCapabilities: string[]
  /** Keywords extracted from the task description */
  keywords: string[]
}

/**
 * Smart router for ACP agent delegation decisions.
 * Analyzes tasks and matches them to available agents based on capabilities.
 */
export class ACPSmartRouter {
  /** Mapping of capabilities to related keywords for task analysis */
  private capabilityKeywords: Map<string, string[]>

  constructor() {
    this.capabilityKeywords = new Map()
    this.initializeCapabilityKeywords()
  }

  /**
   * Initialize the mapping of capabilities to related keywords.
   * These mappings help identify required capabilities from task descriptions.
   */
  private initializeCapabilityKeywords(): void {
    this.capabilityKeywords.set('research', [
      'find', 'search', 'lookup', 'investigate', 'discover', 'research',
      'gather', 'collect', 'explore', 'query', 'fetch', 'retrieve'
    ])
    this.capabilityKeywords.set('coding', [
      'code', 'program', 'implement', 'fix', 'debug', 'write code',
      'develop', 'build', 'create function', 'refactor', 'compile', 'script'
    ])
    this.capabilityKeywords.set('analysis', [
      'analyze', 'compare', 'evaluate', 'assess', 'examine', 'review',
      'inspect', 'audit', 'benchmark', 'measure', 'test', 'validate'
    ])
    this.capabilityKeywords.set('writing', [
      'write', 'draft', 'compose', 'create document', 'author', 'document',
      'summarize', 'describe', 'explain', 'report', 'outline', 'edit'
    ])
    this.capabilityKeywords.set('data', [
      'data', 'database', 'sql', 'query', 'transform', 'etl',
      'process', 'parse', 'convert', 'format', 'extract', 'aggregate'
    ])
    this.capabilityKeywords.set('design', [
      'design', 'layout', 'style', 'ui', 'ux', 'interface',
      'visual', 'mockup', 'wireframe', 'prototype', 'graphic'
    ])
    this.capabilityKeywords.set('deployment', [
      'deploy', 'release', 'publish', 'launch', 'ship', 'rollout',
      'ci', 'cd', 'pipeline', 'infrastructure', 'devops', 'kubernetes', 'docker'
    ])
    this.capabilityKeywords.set('testing', [
      'test', 'qa', 'quality', 'unit test', 'integration test', 'e2e',
      'coverage', 'regression', 'smoke test', 'verify', 'assert'
    ])
  }

  /**
   * Analyze a task to determine its characteristics and requirements.
   *
   * @param task - The task description to analyze
   * @returns Analysis of the task including type, complexity, and required capabilities
   *
   * @example
   * ```typescript
   * const analysis = acpSmartRouter.analyzeTask("Find and summarize the top 5 news articles about AI")
   * // Returns: { taskType: 'multi-step', estimatedComplexity: 5, ... }
   * ```
   */
  analyzeTask(task: string): TaskAnalysis {
    const lowerTask = task.toLowerCase()
    const words = lowerTask.split(/\s+/)

    // Extract keywords from the task
    const keywords = this.extractKeywords(lowerTask)

    // Identify required capabilities based on keywords
    const requiredCapabilities = this.identifyCapabilities(keywords)

    // Identify subtasks by looking for conjunctions and list patterns
    const identifiedSubtasks = this.identifySubtasks(task)

    // Determine task type
    const taskType = this.determineTaskType(identifiedSubtasks, requiredCapabilities)

    // Estimate complexity
    const estimatedComplexity = this.estimateComplexity(
      task,
      words.length,
      identifiedSubtasks.length,
      requiredCapabilities.length
    )

    return {
      taskType,
      estimatedComplexity,
      identifiedSubtasks,
      requiredCapabilities,
      keywords,
    }
  }

  /**
   * Extract meaningful keywords from the task text.
   */
  private extractKeywords(lowerTask: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
      'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'between', 'under',
      'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
      'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
      'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
      'very', 's', 't', 'just', 'don', 'now', 'and', 'but', 'or', 'if', 'it',
      'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
      'your', 'he', 'him', 'she', 'her', 'they', 'them', 'what', 'which', 'who',
      'please', 'help', 'want', 'like', 'get', 'make', 'use'
    ])

    const words = lowerTask.split(/[\s,;:.!?()[\]{}'"]+/).filter(Boolean)
    return words.filter(word => word.length > 2 && !stopWords.has(word))
  }

  /**
   * Identify required capabilities based on task keywords.
   */
  private identifyCapabilities(keywords: string[]): string[] {
    const capabilities = new Set<string>()

    for (const keyword of keywords) {
      for (const [capability, relatedKeywords] of Array.from(this.capabilityKeywords.entries())) {
        if (relatedKeywords.some(rk => keyword.includes(rk) || rk.includes(keyword))) {
          capabilities.add(capability)
        }
      }
    }

    return Array.from(capabilities)
  }

  /**
   * Identify subtasks from the task description.
   * Looks for conjunctions, numbered lists, and sequential indicators.
   */
  private identifySubtasks(task: string): string[] {
    const subtasks: string[] = []

    // Look for "and then", "then", "after that" patterns
    const sequentialSplit = task.split(/\s+(?:and\s+then|then|after\s+that|afterwards|next|finally)\s+/i)
    if (sequentialSplit.length > 1) {
      subtasks.push(...sequentialSplit.map(s => s.trim()).filter(Boolean))
    }

    // Look for numbered lists (1. 2. 3. or 1) 2) 3))
    const numberedMatch = task.match(/(?:^|\s)(\d+[.)]\s*[^0-9]+)/g)
    if (numberedMatch && numberedMatch.length > 1) {
      subtasks.push(...numberedMatch.map(s => s.trim()))
    }

    // Look for bullet-style lists (- or *)
    const bulletMatch = task.match(/(?:^|\n)\s*[-*]\s+([^\n-*]+)/g)
    if (bulletMatch && bulletMatch.length > 1) {
      subtasks.push(...bulletMatch.map(s => s.trim()))
    }

    // Look for comma-separated actions with action verbs
    if (subtasks.length === 0) {
      const commaActions = task.split(/,\s*(?:and\s+)?/)
      const actionVerbs = /^(find|search|create|build|write|analyze|compare|test|deploy|fix|debug|implement)/i
      const actionItems = commaActions.filter(item => actionVerbs.test(item.trim()))
      if (actionItems.length > 1) {
        subtasks.push(...actionItems.map(s => s.trim()))
      }
    }

    return Array.from(new Set(subtasks))
  }

  /**
   * Determine the task type based on subtasks and capabilities.
   */
  private determineTaskType(subtasks: string[], capabilities: string[]): 'simple' | 'complex' | 'multi-step' {
    if (subtasks.length > 1) {
      return 'multi-step'
    }
    if (capabilities.length > 2 || subtasks.length === 1) {
      return 'complex'
    }
    return 'simple'
  }

  /**
   * Convert an ACP agent instance to a unified agent representation.
   */
  private acpToUnifiedAgent(agent: ACPAgentInstance): UnifiedAgent {
    return {
      name: agent.definition.name,
      displayName: agent.definition.displayName || agent.definition.name,
      description: agent.definition.description,
      capabilities: agent.definition.capabilities,
      baseUrl: agent.definition.baseUrl,
    }
  }

  /**
   * Get all available agents as unified agents.
   */
  getAllUnifiedAgents(): UnifiedAgent[] {
    return acpRegistry.getReadyAgents().map(a => this.acpToUnifiedAgent(a))
  }

  /**
   * Find unified agents that match the required capabilities.
   * Returns agents sorted by how well they match the requirements.
   *
   * @param requiredCapabilities - List of capabilities needed for the task
   * @returns Array of unified agents sorted by match score (best first)
   */
  findMatchingUnifiedAgents(requiredCapabilities: string[]): UnifiedAgent[] {
    const allAgents = this.getAllUnifiedAgents()

    if (requiredCapabilities.length === 0) {
      return allAgents
    }

    // Score each agent based on capability overlap
    const scoredAgents = allAgents.map(agent => {
      const matchScore = this.matchCapability(requiredCapabilities, agent.capabilities)
      return { agent, matchScore }
    })

    // Sort by match score (highest first) and filter out zero matches
    return scoredAgents
      .filter(({ matchScore }) => matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .map(({ agent }) => agent)
  }

  /**
   * Estimate task complexity on a scale of 1-10.
   */
  private estimateComplexity(
    task: string,
    wordCount: number,
    subtaskCount: number,
    capabilityCount: number
  ): number {
    let complexity = 1

    // Word count factor
    if (wordCount > 50) complexity += 2
    else if (wordCount > 20) complexity += 1

    // Subtask factor
    complexity += Math.min(subtaskCount * 1.5, 4)

    // Capability factor
    complexity += Math.min(capabilityCount, 3)

    // Complexity indicators in text
    const complexityIndicators = [
      'complex', 'comprehensive', 'detailed', 'thorough', 'extensive',
      'multiple', 'various', 'several', 'all', 'complete', 'full'
    ]
    const lowerTask = task.toLowerCase()
    if (complexityIndicators.some(indicator => lowerTask.includes(indicator))) {
      complexity += 1
    }

    return Math.min(Math.max(Math.round(complexity), 1), 10)
  }

  /**
   * Find agents that match the required capabilities.
   * Returns agents sorted by how well they match the requirements.
   *
   * @param requiredCapabilities - List of capabilities needed for the task
   * @returns Array of agent instances sorted by match score (best first)
   */
  findMatchingAgents(requiredCapabilities: string[]): ACPAgentInstance[] {
    const readyAgents = acpRegistry.getReadyAgents()

    if (requiredCapabilities.length === 0) {
      return readyAgents
    }

    // Score each agent based on capability overlap
    const scoredAgents = readyAgents.map(agent => {
      const agentCapabilities = agent.definition.capabilities
      const matchScore = this.matchCapability(requiredCapabilities, agentCapabilities)
      return { agent, matchScore }
    })

    // Sort by match score (highest first) and filter out zero matches
    return scoredAgents
      .filter(({ matchScore }) => matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .map(({ agent }) => agent)
  }

  /**
   * Calculate overlap score between required capabilities and agent capabilities.
   *
   * @param taskCapabilities - Capabilities required by the task
   * @param agentCapabilities - Capabilities the agent provides
   * @returns Score from 0 (no match) to 1 (perfect match)
   *
   * @example
   * ```typescript
   * const score = acpSmartRouter.matchCapability(['research', 'writing'], ['research', 'analysis'])
   * // Returns: 0.5 (1 out of 2 capabilities matched)
   * ```
   */
  matchCapability(taskCapabilities: string[], agentCapabilities: string[]): number {
    if (taskCapabilities.length === 0) {
      return agentCapabilities.length > 0 ? 0.5 : 0
    }

    const matchedCount = taskCapabilities.filter(tc =>
      agentCapabilities.some(ac =>
        ac.toLowerCase() === tc.toLowerCase() ||
        ac.toLowerCase().includes(tc.toLowerCase()) ||
        tc.toLowerCase().includes(ac.toLowerCase())
      )
    ).length

    return matchedCount / taskCapabilities.length
  }

  /**
   * Suggest whether a task should be delegated to a sub-agent.
   * Analyzes the task and finds matching agents to provide a routing decision.
   *
   * @param task - The task description to evaluate
   * @returns Routing decision with suggested agents if delegation is recommended
   *
   * @example
   * ```typescript
   * const decision = acpSmartRouter.suggestDelegation("Research competitor pricing and create a summary report")
   * if (decision.shouldDelegate) {
   *   console.log(`Suggested agents: ${decision.suggestedAgents?.map(a => a.agentName).join(', ')}`)
   * }
   * ```
   */
  suggestDelegation(task: string): RoutingDecision {
    const analysis = this.analyzeTask(task)

    // Simple tasks with no special capabilities don't need delegation
    if (analysis.taskType === 'simple' && analysis.requiredCapabilities.length === 0) {
      return {
        shouldDelegate: false,
        reason: 'Task is simple and does not require specialized capabilities.',
      }
    }

    // Find matching agents
    const matchingAgents = this.findMatchingAgents(analysis.requiredCapabilities)

    // No matching agents available
    if (matchingAgents.length === 0) {
      if (analysis.requiredCapabilities.length > 0) {
        return {
          shouldDelegate: false,
          reason: `No available agents match the required capabilities: ${analysis.requiredCapabilities.join(', ')}`,
        }
      }
      return {
        shouldDelegate: false,
        reason: 'No specialized agents are currently available.',
      }
    }

    // Build suggested agents with confidence scores
    const suggestedAgents = matchingAgents.map(agent => {
      const agentCapabilities = agent.definition.capabilities
      const matchedCapabilities = analysis.requiredCapabilities.filter(rc =>
        agentCapabilities.some(ac =>
          ac.toLowerCase().includes(rc.toLowerCase()) ||
          rc.toLowerCase().includes(ac.toLowerCase())
        )
      )

      const confidence = this.matchCapability(analysis.requiredCapabilities, agentCapabilities)

      return {
        agentName: agent.definition.name,
        confidence,
        matchedCapabilities,
        suggestedTask: task, // Could be refined to extract relevant portion
      }
    })

    // Determine if delegation is worthwhile
    const bestMatch = suggestedAgents[0]
    const shouldDelegate = bestMatch.confidence >= 0.3 || analysis.taskType !== 'simple'

    return {
      shouldDelegate,
      reason: shouldDelegate
        ? `Task matches ${bestMatch.matchedCapabilities.length} capabilities of available agents. ` +
          `Best match: ${bestMatch.agentName} (${Math.round(bestMatch.confidence * 100)}% confidence).`
        : 'Available agents do not sufficiently match the task requirements.',
      suggestedAgents: shouldDelegate ? suggestedAgents : undefined,
    }
  }

  /**
   * Suggest delegation considering all available agents (unified routing).
   * This is the preferred method for new code.
   *
   * @param task - The task description to evaluate
   * @returns Routing decision with suggested agents
   */
  suggestUnifiedDelegation(task: string): RoutingDecision {
    const analysis = this.analyzeTask(task)

    // Simple tasks with no special capabilities don't need delegation
    if (analysis.taskType === 'simple' && analysis.requiredCapabilities.length === 0) {
      return {
        shouldDelegate: false,
        reason: 'Task is simple and does not require specialized capabilities.',
      }
    }

    // Find matching agents
    const matchingAgents = this.findMatchingUnifiedAgents(analysis.requiredCapabilities)

    // No matching agents available
    if (matchingAgents.length === 0) {
      if (analysis.requiredCapabilities.length > 0) {
        return {
          shouldDelegate: false,
          reason: `No available agents match the required capabilities: ${analysis.requiredCapabilities.join(', ')}`,
        }
      }
      return {
        shouldDelegate: false,
        reason: 'No specialized agents are currently available.',
      }
    }

    // Build suggested agents with confidence scores
    const suggestedAgents = matchingAgents.map(agent => {
      const matchedCapabilities = analysis.requiredCapabilities.filter(rc =>
        agent.capabilities.some(ac =>
          ac.toLowerCase().includes(rc.toLowerCase()) ||
          rc.toLowerCase().includes(ac.toLowerCase())
        )
      )

      const confidence = this.matchCapability(analysis.requiredCapabilities, agent.capabilities)

      return {
        agentName: agent.name,
        confidence,
        matchedCapabilities,
        suggestedTask: task,
        baseUrl: agent.baseUrl,
      }
    })

    // Determine if delegation is worthwhile
    const bestMatch = suggestedAgents[0]
    const shouldDelegate = bestMatch.confidence >= 0.3 || analysis.taskType !== 'simple'

    return {
      shouldDelegate,
      reason: shouldDelegate
        ? `Task matches ${bestMatch.matchedCapabilities.length} capabilities of available agents. ` +
          `Best match: ${bestMatch.agentName} (${Math.round(bestMatch.confidence * 100)}% confidence).`
        : 'Available agents do not sufficiently match the task requirements.',
      suggestedAgents: shouldDelegate ? suggestedAgents : undefined,
    }
  }

  /**
   * Generate system prompt text describing available agents.
   * This text can be injected into the main AI's system prompt to inform it
   * about delegation options.
   *
   * @param availableAgents - List of agents to include in the prompt
   * @returns Formatted string for system prompt injection
   *
   * @example
   * ```typescript
   * const agents = acpRegistry.getReadyAgents()
   * const promptAddition = acpSmartRouter.generateDelegationPromptAddition(agents)
   * // Returns: "You have access to the following specialized agents..."
   * ```
   */
  generateDelegationPromptAddition(availableAgents: ReadonlyArray<ACPAgentForDelegationPrompt>): string {
    if (availableAgents.length === 0) {
      return ''
    }

    const agentDescriptions = availableAgents.map(agent => {
      const def = agent.definition
      const capabilities = def.capabilities.length > 0
        ? `Capabilities: ${def.capabilities.join(', ')}`
        : 'General purpose agent'

      return `- **${def.displayName || def.name}**: ${def.description || 'No description available'}
  ${capabilities}`
    }).join('\n')

    return `
## Available Specialized Agents

You have access to the following specialized agents that can help with specific tasks.
Consider delegating work to these agents when appropriate:

${agentDescriptions}

### When to Delegate
- Use the **research** agent for information gathering, web searches, and fact-finding
- Use the **coding** agent for complex programming tasks, debugging, or code generation
- Use the **analysis** agent for data analysis, comparisons, and evaluations
- Use the **writing** agent for document creation, summarization, and content drafting

### How to Delegate
Use the delegate_to_agent tool with the agent name and a clear task description.
Monitor the agent's progress and incorporate its results into your response.
`.trim()
  }
}

/** Singleton instance of the ACP smart router */
export const acpSmartRouter = new ACPSmartRouter()
