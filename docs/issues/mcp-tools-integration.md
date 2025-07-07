# 🔧 Implement MCP Tools Integration for Voice-Activated Actions

**Status:** Proposed
**Priority:** High
**Labels:** enhancement, feature, mcp, voice-commands

## Overview

Implement Model Context Protocol (MCP) tools integration to enable voice-activated actions beyond simple text transcription. This would allow users to trigger various tools and actions through speech commands.

## Background

Based on user feedback, there's a need to extend SpeakMCP beyond simple dictation to support voice-activated tool execution. The MCP (Model Context Protocol) provides a standardized way to integrate various tools and services.

## Requirements

### Core Functionality
- [ ] Integrate MCP tool calling capability
- [ ] Send transcribed speech to LLM with available tools context
- [ ] Parse structured JSON responses from LLM for tool execution
- [ ] Execute MCP tools based on LLM decisions
- [ ] Provide feedback to user on tool execution results

### User Experience
- [ ] Add dedicated shortcut for MCP tool mode (separate from regular dictation)
- [ ] Use consistent shortcut pattern with existing speech-to-text controls
- [ ] Visual feedback when in tool mode vs dictation mode
- [ ] Error handling and user feedback for failed tool executions

### Configuration
- [ ] Settings page for MCP tool configuration
- [ ] Enable/disable MCP tools functionality
- [ ] Configure available tools and their permissions
- [ ] Tool discovery and registration system

## Technical Implementation

### Architecture Changes
```typescript
// New MCP service
interface MCPService {
  getAvailableTools(): Tool[]
  executeToolCall(toolCall: ToolCall): Promise<ToolResult>
}

// Enhanced LLM service
interface LLMService {
  processWithTools(transcript: string, tools: Tool[]): Promise<LLMResponse>
}
```

### Integration Points
1. **Speech Processing**: Extend existing STT pipeline
2. **LLM Enhancement**: Modify `src/main/llm.ts` to support tool calling
3. **Tool Execution**: New service for MCP tool management
4. **UI Updates**: Settings and feedback components
5. **Keyboard Shortcuts**: Extend `src/main/keyboard.ts` for tool mode

### Data Flow
```
User Speech → STT → LLM (with tools) → Tool Execution → User Feedback
```

## Configuration Schema

```typescript
interface MCPConfig {
  enabled: boolean
  shortcut: 'ctrl-alt-hold' | 'ctrl-alt-slash' // Consistent with existing patterns
  availableTools: ToolConfig[]
  llmProvider: CHAT_PROVIDER_ID // Reuse existing LLM configuration
  systemPrompt: string // Instructions for tool usage
}
```

## User Stories

1. **As a developer**, I want to say "create a new file called utils.ts" and have it automatically create the file
2. **As a user**, I want to say "send an email to John about the meeting" and have it compose and send the email
3. **As a power user**, I want to configure which tools are available for voice activation
4. **As a user**, I want clear feedback when tools are executed successfully or fail

## Implementation Plan

### Phase 1: Core Infrastructure
- [ ] Design MCP service architecture
- [ ] Implement basic tool calling in LLM service
- [ ] Add configuration schema and storage
- [ ] Create basic UI for MCP settings

### Phase 2: Tool Integration
- [ ] Implement file system tools (create, read, write files)
- [ ] Add browser automation tools
- [ ] Integrate with system clipboard and notifications
- [ ] Add email and calendar tools

### Phase 3: User Experience
- [ ] Implement dedicated MCP shortcut handling
- [ ] Add visual feedback and status indicators
- [ ] Create comprehensive error handling
- [ ] Add tool execution history and logging

### Phase 4: Advanced Features
- [ ] Tool chaining and workflows
- [ ] Custom tool development API
- [ ] Integration with external MCP servers
- [ ] Voice confirmation for destructive actions

## Acceptance Criteria

- [ ] Users can enable MCP tools in settings
- [ ] Dedicated keyboard shortcut for tool mode (consistent with existing patterns)
- [ ] LLM processes speech with tool context and returns structured responses
- [ ] Tools execute successfully based on LLM decisions
- [ ] Clear user feedback for tool execution status
- [ ] Fallback to regular dictation if no tools are triggered
- [ ] Comprehensive error handling and logging

## Related Issues

- Configuration system enhancements
- LLM provider abstraction improvements
- Keyboard shortcut consistency

## Notes

- Should reuse existing LLM configuration and providers
- Maintain consistency with current shortcut patterns
- Consider security implications of tool execution
- Ensure graceful degradation when tools are unavailable
