import { describe, it, expect } from 'vitest'
import { getOAuthExample, getOAuthExampleKeys, OAUTH_MCP_EXAMPLES } from './oauth-examples'

describe('oauth-examples', () => {
  it('returns known example by key', () => {
    const ex = getOAuthExample('notion')
    expect(ex).toBeTruthy()
    expect(ex?.name).toBe('Notion')
    expect(ex?.config.transport).toBe('streamableHttp')
    expect(ex?.config.oauth?.useDiscovery).toBe(true)
    expect(Array.isArray(ex?.setupInstructions)).toBe(true)
    expect(ex?.setupInstructions.length).toBeGreaterThan(0)
  })

  it('returns undefined for unknown key', () => {
    expect(getOAuthExample('missing')).toBeUndefined()
  })

  it('lists all example keys and includes notion', () => {
    const keys = getOAuthExampleKeys()
    expect(keys).toContain('notion')
    // sanity: keys should match object keys
    expect(keys.sort()).toEqual(Object.keys(OAUTH_MCP_EXAMPLES).sort())
  })
})

