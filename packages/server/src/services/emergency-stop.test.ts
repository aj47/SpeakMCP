import { describe, it, expect, vi } from 'vitest'
import { emergencyStopAll } from './emergency-stop'

describe('emergencyStopAll', () => {
  it('should be defined and callable', async () => {
    expect(emergencyStopAll).toBeDefined()
    expect(typeof emergencyStopAll).toBe('function')
  })

  it('should return a Promise with before/after counts', async () => {
    const result = await emergencyStopAll()
    expect(result).toHaveProperty('before')
    expect(result).toHaveProperty('after')
    expect(typeof result.before).toBe('number')
    expect(typeof result.after).toBe('number')
  })
})
