import { parseShellCommand } from './shell-parse'

describe('parseShellCommand', () => {
  it('should parse simple command without arguments', () => {
    const result = parseShellCommand('npx')
    expect(result).toEqual({ command: 'npx', args: [] })
  })

  it('should parse command with simple arguments', () => {
    const result = parseShellCommand('npx -y @modelcontextprotocol/server-google-maps')
    expect(result).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-google-maps']
    })
  })

  it('should handle double-quoted paths with spaces', () => {
    const result = parseShellCommand('"C:\\Program Files\\My Server\\run.bat" --arg value')
    expect(result).toEqual({
      command: 'C:\\Program Files\\My Server\\run.bat',
      args: ['--arg', 'value']
    })
  })

  it('should handle single-quoted paths with spaces', () => {
    const result = parseShellCommand("'C:\\Program Files\\My Server\\run.bat' --arg value")
    expect(result).toEqual({
      command: 'C:\\Program Files\\My Server\\run.bat',
      args: ['--arg', 'value']
    })
  })

  it('should handle mixed quotes', () => {
    const result = parseShellCommand('node "path with spaces/script.js" arg1 arg2')
    expect(result).toEqual({
      command: 'node',
      args: ['path with spaces/script.js', 'arg1', 'arg2']
    })
  })

  it('should handle escaped characters', () => {
    const result = parseShellCommand('echo "hello\\"world"')
    expect(result).toEqual({
      command: 'echo',
      args: ['hello"world']
    })
  })

  it('should handle multiple spaces between arguments', () => {
    const result = parseShellCommand('cmd   arg1    arg2')
    expect(result).toEqual({
      command: 'cmd',
      args: ['arg1', 'arg2']
    })
  })

  it('should handle empty string', () => {
    const result = parseShellCommand('')
    expect(result).toEqual({ command: '', args: [] })
  })

  it('should handle whitespace-only string', () => {
    const result = parseShellCommand('   ')
    expect(result).toEqual({ command: '', args: [] })
  })

  it('should preserve backslashes in Windows paths', () => {
    const result = parseShellCommand('"C:\\Users\\test\\file.exe" --flag')
    expect(result).toEqual({
      command: 'C:\\Users\\test\\file.exe',
      args: ['--flag']
    })
  })
})

