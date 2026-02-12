import { describe, it, expect } from 'vitest'
import { cleanErrorMessage, analyzeToolErrors } from './error-utils'

describe('Error Utils - cleanErrorMessage', () => {
  it('should remove stack traces from error messages', () => {
    const errorWithStack = `Error: Something went wrong
    at Function.test (/app/src/index.ts:10:5)
    at Object.<anonymous> (/app/test.js:5:10)
    at Module._compile (node:internal/process:12345)`
    
    const result = cleanErrorMessage(errorWithStack)
    expect(result).toBe('Error: Something went wrong')
    expect(result).not.toContain('at ')
  })

  it('should remove file path lines in stack traces', () => {
    const errorWithPaths = `ReferenceError: x is not defined
    at file:///app/src/main.ts:15:3
    at https://cdn.example.com/bundle.js:1:42`
    
    const result = cleanErrorMessage(errorWithPaths)
    expect(result).toBe('ReferenceError: x is not defined')
    expect(result).not.toContain('file://')
    expect(result).not.toContain('https://')
  })

  it('should remove duplicate error class names', () => {
    const errorWithDuplicate = `TypeError: TypeError: Invalid argument provided`
    
    const result = cleanErrorMessage(errorWithDuplicate)
    expect(result).toBe('TypeError: Invalid argument provided')
  })

  it('should truncate very long error messages', () => {
    const longError = 'Error: ' + 'x'.repeat(600)
    
    const result = cleanErrorMessage(longError)
    expect(result.length).toBeLessThan(longError.length)
    expect(result).toContain('...')
  })

  it('should preserve meaningful error content without stack traces', () => {
    const cleanError = `ConnectionError: Failed to connect to database
Please check your network connection and try again.`
    
    const result = cleanErrorMessage(cleanError)
    expect(result).toBe(cleanError)
  })
})

describe('Error Utils - analyzeToolErrors', () => {
  it('should detect timeout errors', () => {
    const result = analyzeToolErrors([
      { isError: true, content: [{ type: 'text', text: 'Request timed out after 30s' }] },
    ])
    
    expect(result.errorTypes).toContain('timeout')
  })

  it('should detect connectivity errors', () => {
    const result = analyzeToolErrors([
      { isError: true, content: [{ type: 'text', text: 'Connection refused by server' }] },
      { isError: true, content: [{ type: 'text', text: 'Network is unreachable' }] },
    ])
    
    expect(result.errorTypes).toContain('connectivity')
  })

  it('should detect permission errors', () => {
    const result = analyzeToolErrors([
      { isError: true, content: [{ type: 'text', text: 'Permission denied: access denied' }] },
    ])
    
    expect(result.errorTypes).toContain('permissions')
  })

  it('should detect not found errors', () => {
    const result = analyzeToolErrors([
      { isError: true, content: [{ type: 'text', text: 'File does not exist' }] },
    ])
    
    expect(result.errorTypes).toContain('not_found')
  })

  it('should detect invalid parameter errors', () => {
    const result = analyzeToolErrors([
      { isError: true, content: [{ type: 'text', text: 'Invalid JSON format expected object' }] },
    ])
    
    expect(result.errorTypes).toContain('invalid_params')
  })

  it('should handle multiple error types in one response', () => {
    const result = analyzeToolErrors([
      { isError: true, content: [{ type: 'text', text: 'Connection timeout - permission denied' }] },
    ])
    
    expect(result.errorTypes.length).toBeGreaterThan(1)
  })

  it('should return empty errorTypes for successful results', () => {
    const result = analyzeToolErrors([
      { isError: false, content: [{ type: 'text', text: 'Success' }] },
    ])
    
    expect(result.errorTypes).toHaveLength(0)
  })
})
