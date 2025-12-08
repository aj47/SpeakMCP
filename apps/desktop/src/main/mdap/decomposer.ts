/**
 * MDAP Task Decomposer
 * Breaks complex tasks into minimal subtasks using Maximal Agentic Decomposition (MAD)
 */

import { MDAPSubtask, DecompositionResult, MDAPConfig, DEFAULT_MDAP_CONFIG } from './types'
import { makeTextCompletionWithFetch } from '../llm-fetch'
import { configStore } from '../config'
import { logApp } from '../debug'

/**
 * System prompt for task decomposition
 */
const DECOMPOSITION_SYSTEM_PROMPT = `You are a task decomposition specialist. Your role is to break down complex tasks into the smallest possible atomic subtasks.

PRINCIPLES OF MAXIMAL AGENTIC DECOMPOSITION (MAD):
1. Each subtask should be completable in a single, focused step
2. Subtasks should have clear inputs and outputs
3. The output of one subtask becomes the input for the next
4. Each subtask should be independently verifiable
5. Minimize context required for each subtask

OUTPUT FORMAT:
You must respond with a valid JSON object in this exact format:
{
  "initialState": "Description of the starting state/input",
  "subtasks": [
    {
      "index": 0,
      "description": "Clear, specific description of what this subtask does",
      "expectedOutputFormat": "What the output should look like"
    },
    ...
  ],
  "estimatedComplexity": "simple" | "moderate" | "complex",
  "suggestedKThreshold": 3
}

RULES:
- Break tasks into the SMALLEST possible steps
- Each step should do ONE thing only
- Be explicit about state transitions
- For calculations, break into individual operations
- For transformations, process one element at a time
- suggestedKThreshold should be 3 for simple tasks, 5 for moderate, 7+ for complex`

/**
 * Decomposes a task into subtasks using LLM
 */
export async function decomposeTask(
  task: string,
  config: Partial<MDAPConfig> = {}
): Promise<DecompositionResult> {
  const fullConfig = { ...DEFAULT_MDAP_CONFIG, ...config }
  const appConfig = configStore.get()

  const decompositionPrompt = `Decompose the following task into minimal subtasks:

TASK: ${task}

Remember:
- Each subtask should be the smallest possible unit of work
- The output of subtask N becomes the input for subtask N+1
- Be explicit about what each subtask receives and produces
- Limit to at most ${fullConfig.maxSubtasks} subtasks

Respond with a JSON object containing the decomposition.`

  try {
    const providerId = fullConfig.decompositionModel || appConfig.mcpToolsProviderId || 'openai'
    const response = await makeTextCompletionWithFetch(
      `${DECOMPOSITION_SYSTEM_PROMPT}\n\nUser: ${decompositionPrompt}`,
      providerId
    )

    // Parse the JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logApp('[MDAP Decomposer] Failed to extract JSON from response')
      // Fall back to single-step execution
      return createSingleStepDecomposition(task)
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and transform the response
    const subtasks: MDAPSubtask[] = (parsed.subtasks || []).map(
      (st: any, index: number) => ({
        id: `subtask_${index}_${Date.now()}`,
        index: st.index ?? index,
        description: st.description || `Step ${index + 1}`,
        inputState: index === 0 ? parsed.initialState : `Output from step ${index}`,
        expectedOutputFormat: st.expectedOutputFormat,
        dependencies: index > 0 ? [`subtask_${index - 1}_${Date.now()}`] : undefined,
      })
    )

    // Ensure at least one subtask
    if (subtasks.length === 0) {
      return createSingleStepDecomposition(task)
    }

    // Cap at maxSubtasks
    const cappedSubtasks = subtasks.slice(0, fullConfig.maxSubtasks)

    return {
      originalTask: task,
      subtasks: cappedSubtasks,
      initialState: parsed.initialState || task,
      estimatedComplexity: parsed.estimatedComplexity || 'moderate',
      suggestedKThreshold: parsed.suggestedKThreshold || 3,
    }
  } catch (error) {
    logApp('[MDAP Decomposer] Error during decomposition:', error)
    // Fall back to single-step execution
    return createSingleStepDecomposition(task)
  }
}

/**
 * Creates a single-step decomposition for simple tasks
 */
function createSingleStepDecomposition(task: string): DecompositionResult {
  const subtaskId = `subtask_0_${Date.now()}`
  return {
    originalTask: task,
    subtasks: [
      {
        id: subtaskId,
        index: 0,
        description: task,
        inputState: 'Initial request',
        expectedOutputFormat: 'Complete response to the task',
      },
    ],
    initialState: task,
    estimatedComplexity: 'simple',
    suggestedKThreshold: 3,
  }
}

/**
 * Validates that a decomposition is well-formed
 */
export function validateDecomposition(decomposition: DecompositionResult): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []

  if (!decomposition.subtasks || decomposition.subtasks.length === 0) {
    issues.push('No subtasks in decomposition')
  }

  for (const subtask of decomposition.subtasks) {
    if (!subtask.description || subtask.description.trim() === '') {
      issues.push(`Subtask ${subtask.index} has no description`)
    }
    if (subtask.index < 0) {
      issues.push(`Subtask has invalid index: ${subtask.index}`)
    }
  }

  // Check for duplicate indices
  const indices = new Set<number>()
  for (const subtask of decomposition.subtasks) {
    if (indices.has(subtask.index)) {
      issues.push(`Duplicate subtask index: ${subtask.index}`)
    }
    indices.add(subtask.index)
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/**
 * Estimates the K-threshold based on task complexity
 * k_min = Θ(ln s) where s is the number of steps
 */
export function estimateKThreshold(subtaskCount: number): number {
  // Based on the MAKER paper: k_min scales logarithmically with task size
  // For practical purposes, we use: k = max(3, ceil(ln(subtaskCount) + 1))
  const calculatedK = Math.ceil(Math.log(Math.max(subtaskCount, 1)) + 1)
  return Math.max(3, Math.min(calculatedK, 10)) // Clamp between 3 and 10
}

/**
 * Recursively decomposes a complex subtask into smaller steps
 */
export async function recursiveDecompose(
  subtask: MDAPSubtask,
  depth: number = 0,
  maxDepth: number = 3,
  config: Partial<MDAPConfig> = {}
): Promise<MDAPSubtask[]> {
  if (depth >= maxDepth) {
    return [subtask]
  }

  // Check if subtask is simple enough
  const wordCount = subtask.description.split(/\s+/).length
  if (wordCount < 10) {
    return [subtask]
  }

  // Try to decompose further
  const result = await decomposeTask(subtask.description, config)

  if (result.subtasks.length === 1) {
    return [subtask]
  }

  // Recursively decompose each resulting subtask
  const allSubtasks: MDAPSubtask[] = []
  for (const st of result.subtasks) {
    const subSubtasks = await recursiveDecompose(st, depth + 1, maxDepth, config)
    allSubtasks.push(...subSubtasks)
  }

  return allSubtasks
}

/**
 * Merges small consecutive subtasks if they're too granular
 */
export function optimizeDecomposition(
  subtasks: MDAPSubtask[],
  minSubtaskSize: number = 5 // Minimum word count
): MDAPSubtask[] {
  if (subtasks.length <= 1) {
    return subtasks
  }

  const optimized: MDAPSubtask[] = []
  let pendingMerge: MDAPSubtask | null = null

  for (const subtask of subtasks) {
    const wordCount = subtask.description.split(/\s+/).length

    if (wordCount < minSubtaskSize && pendingMerge !== null) {
      // Merge with pending
      const merged: MDAPSubtask = {
        id: pendingMerge.id,
        index: pendingMerge.index,
        description: `${pendingMerge.description}. Then, ${subtask.description}`,
        inputState: pendingMerge.inputState,
        expectedOutputFormat: pendingMerge.expectedOutputFormat,
        dependencies: pendingMerge.dependencies,
      }
      pendingMerge = merged
    } else if (wordCount < minSubtaskSize) {
      // Start a new pending merge
      pendingMerge = subtask
    } else {
      // Normal subtask
      if (pendingMerge) {
        optimized.push(pendingMerge)
        pendingMerge = null
      }
      optimized.push(subtask)
    }
  }

  // Don't forget the last pending merge
  if (pendingMerge) {
    optimized.push(pendingMerge)
  }

  // Re-index
  return optimized.map((st, idx) => ({
    ...st,
    index: idx,
    id: `subtask_${idx}_${Date.now()}`,
  }))
}
