# Contributing to SpeakMCP

Welcome to SpeakMCP! This guide will help you understand the project architecture and get you up and running quickly as a contributor.

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ with **pnpm** package manager
- **Rust** toolchain for building the native binary
- **Xcode Command Line Tools** (macOS) or **Visual Studio Build Tools** (Windows)

### Setup
```bash
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP
pnpm install
pnpm build-rs
pnpm dev
```

## 🏗️ Architecture Overview

SpeakMCP is built with a modern, multi-process architecture designed for performance, reliability, and extensibility.

### High-Level System Architecture

```mermaid
graph TB
    subgraph "User Interface"
        UI[React UI<br/>Renderer Process]
        Panel[Panel Window<br/>Voice/Agent UI]
    end
    
    subgraph "Core System"
        Main[Electron Main Process<br/>System Integration]
        Rust[Rust Binary<br/>Keyboard & Text Injection]
    end
    
    subgraph "External Services"
        STT[Speech-to-Text<br/>OpenAI/Groq]
        LLM[Language Models<br/>GPT/Gemini/Groq]
        MCP[MCP Servers<br/>Tools & Services]
    end
    
    UI <--> Main
    Panel <--> Main
    Main <--> Rust
    Main <--> STT
    Main <--> LLM
    Main <--> MCP
    
    style UI fill:#e1f5fe
    style Panel fill:#e1f5fe
    style Main fill:#f3e5f5
    style Rust fill:#fff3e0
    style STT fill:#e8f5e8
    style LLM fill:#e8f5e8
    style MCP fill:#e8f5e8
```

### Process Communication Flow

```mermaid
sequenceDiagram
    participant User
    participant Rust as Rust Binary
    participant Main as Main Process
    participant UI as React UI
    participant API as External APIs
    participant MCP as MCP Servers

    User->>Rust: Press Ctrl (keyboard event)
    Rust->>Main: Keyboard event via IPC
    Main->>UI: Show panel window
    Main->>UI: Start recording indicator
    
    User->>Rust: Release Ctrl
    Rust->>Main: Stop recording event
    Main->>API: Send audio to STT
    API-->>Main: Return transcript
    
    alt Agent Mode
        Main->>MCP: Get available tools
        MCP-->>Main: Return tool list
        Main->>API: Process with LLM + tools
        API-->>Main: Return tool calls
        Main->>MCP: Execute tools
        MCP-->>Main: Return results
        Main->>API: Continue processing
    else Simple Mode
        Main->>API: Process transcript
        API-->>Main: Return response
    end
    
    Main->>Rust: Insert text
    Main->>UI: Hide panel window
```

## 📁 Project Structure

### Directory Layout

```mermaid
graph TD
    Root[SpeakMCP/] --> Src[src/]
    Root --> Rust[speakmcp-rs/]
    Root --> Scripts[scripts/]
    Root --> Docs[docs/]
    
    Src --> Main[main/<br/>Electron Main Process]
    Src --> Renderer[renderer/<br/>React UI]
    Src --> Preload[preload/<br/>IPC Bridge]
    Src --> Shared[shared/<br/>Types & Utils]
    
    Main --> MainFiles[tipc.ts<br/>keyboard.ts<br/>llm.ts<br/>mcp-service.ts<br/>conversation-service.ts]
    
    Renderer --> RendererSrc[src/]
    RendererSrc --> Pages[pages/<br/>App Screens]
    RendererSrc --> Components[components/<br/>UI Components]
    RendererSrc --> Contexts[contexts/<br/>State Management]
    
    Rust --> RustSrc[src/<br/>System Integration]
    
    style Main fill:#f3e5f5
    style Renderer fill:#e1f5fe
    style Rust fill:#fff3e0
```

### Core Components

```mermaid
graph LR
    subgraph "Main Process Components"
        TIPC[TIPC Router<br/>API Handlers]
        Keyboard[Keyboard Service<br/>Event Handling]
        LLM[LLM Service<br/>AI Processing]
        MCP[MCP Service<br/>Tool Management]
        Conv[Conversation Service<br/>History Management]
    end
    
    subgraph "UI Components"
        Layout[App Layout<br/>Navigation]
        Panel[Panel Window<br/>Recording UI]
        Progress[Agent Progress<br/>Real-time Updates]
        Settings[Settings Pages<br/>Configuration]
    end
    
    TIPC <--> Layout
    TIPC <--> Panel
    TIPC <--> Progress
    TIPC <--> Settings
    
    Keyboard --> TIPC
    LLM --> TIPC
    MCP --> TIPC
    Conv --> TIPC
    
    style TIPC fill:#ffeb3b
    style Panel fill:#4caf50
    style Progress fill:#2196f3
```

## 🎯 User Flow Diagrams

### Voice Recording Flow

```mermaid
flowchart TD
    Start([User presses Ctrl]) --> Check{Accessibility<br/>Permissions?}
    Check -->|No| Error[Show Setup Window]
    Check -->|Yes| Show[Show Panel Window]
    Show --> Record[Start Recording]
    Record --> Release{User releases<br/>Ctrl?}
    Release -->|No| Record
    Release -->|Yes| Stop[Stop Recording]
    Stop --> Process[Send to STT API]
    Process --> Insert[Insert Text]
    Insert --> Hide[Hide Panel]
    Hide --> End([Complete])
    
    style Start fill:#4caf50
    style End fill:#4caf50
    style Error fill:#f44336
    style Record fill:#2196f3
```

### Agent Mode Flow

```mermaid
flowchart TD
    Start([User presses Ctrl+Alt]) --> Panel[Show Agent Panel]
    Panel --> Record[Record Voice Input]
    Record --> STT[Convert to Text]
    STT --> Tools[Get Available Tools]
    Tools --> LLM[Send to LLM with Tools]
    LLM --> Decide{LLM wants to<br/>use tools?}
    
    Decide -->|Yes| Execute[Execute Tool Calls]
    Execute --> Results[Get Tool Results]
    Results --> Continue{Continue<br/>processing?}
    Continue -->|Yes| LLM
    Continue -->|No| Final[Final Response]
    
    Decide -->|No| Final
    Final --> Display[Display Results]
    Display --> End([Complete])
    
    style Start fill:#4caf50
    style Execute fill:#ff9800
    style Final fill:#9c27b0
    style End fill:#4caf50
```

## 🔧 Component Interactions

### MCP Integration Architecture

```mermaid
graph TB
    subgraph "MCP Service Layer"
        MCPService[MCP Service<br/>Connection Manager]
        ServerA[MCP Server A<br/>Filesystem]
        ServerB[MCP Server B<br/>Web Search]
        ServerC[MCP Server C<br/>Custom Tools]
    end
    
    subgraph "Agent Processing"
        LLMService[LLM Service<br/>Tool Planning]
        ToolExecutor[Tool Executor<br/>Call Management]
        ResultProcessor[Result Processor<br/>Response Handling]
    end
    
    subgraph "UI Feedback"
        AgentProgress[Agent Progress<br/>Real-time Updates]
        ConversationUI[Conversation UI<br/>History Display]
    end
    
    MCPService <--> ServerA
    MCPService <--> ServerB
    MCPService <--> ServerC
    
    LLMService --> ToolExecutor
    ToolExecutor --> MCPService
    MCPService --> ResultProcessor
    ResultProcessor --> LLMService
    
    ToolExecutor --> AgentProgress
    ResultProcessor --> ConversationUI
    
    style MCPService fill:#ff9800
    style LLMService fill:#9c27b0
    style AgentProgress fill:#2196f3
```

### Conversation Management

```mermaid
stateDiagram-v2
    [*] --> NoConversation
    NoConversation --> NewConversation: First message
    NewConversation --> ActiveConversation: Save conversation
    ActiveConversation --> ActiveConversation: Add messages
    ActiveConversation --> PersistentStorage: Auto-save
    PersistentStorage --> ActiveConversation: Load conversation
    ActiveConversation --> ConversationList: View all conversations
    ConversationList --> ActiveConversation: Select conversation
    ActiveConversation --> [*]: Close app
    
    state ActiveConversation {
        [*] --> UserMessage
        UserMessage --> Processing
        Processing --> AssistantResponse
        AssistantResponse --> UserMessage
        
        state Processing {
            [*] --> STT
            STT --> LLM
            LLM --> ToolCalls
            ToolCalls --> Results
            Results --> FinalResponse
            FinalResponse --> [*]
        }
    }
```

## 🛠️ Development Workflow

### Setting Up Development Environment

```mermaid
flowchart LR
    Clone[Clone Repository] --> Install[pnpm install]
    Install --> BuildRust[pnpm build-rs]
    BuildRust --> Dev[pnpm dev]
    Dev --> Ready[Development Ready]
    
    Ready --> Code[Write Code]
    Code --> Test[Run Tests]
    Test --> TypeCheck[pnpm typecheck]
    TypeCheck --> Lint[pnpm lint]
    Lint --> Build[pnpm build]
    Build --> PR[Create PR]
    
    style Clone fill:#4caf50
    style Ready fill:#4caf50
    style PR fill:#2196f3
```

### Testing Strategy

```mermaid
graph TD
    subgraph "Testing Layers"
        Unit[Unit Tests<br/>Service Logic]
        Integration[Integration Tests<br/>MCP Communication]
        E2E[E2E Tests<br/>Full User Flow]
    end
    
    subgraph "Test Infrastructure"
        MockMCP[Mock MCP Server<br/>scripts/mock-mcp-server.mjs]
        TestUtils[Test Utilities<br/>src/main/__tests__/]
        PathTests[PATH Resolution Tests<br/>MCP Server Discovery]
    end
    
    Unit --> MockMCP
    Integration --> MockMCP
    Integration --> PathTests
    E2E --> TestUtils
    
    style Unit fill:#e8f5e8
    style Integration fill:#fff3e0
    style E2E fill:#f3e5f5
```

## 📋 Contribution Areas

### Priority Areas for Contributors

1. **🐛 Bug Fixes & Stability**
   - MCP server connection issues
   - Keyboard event handling edge cases
   - Memory leaks in long conversations

2. **✨ Feature Enhancements**
   - New MCP server integrations
   - Additional LLM provider support
   - UI/UX improvements

3. **🧪 Testing & Quality**
   - Expand test coverage
   - Add integration tests
   - Performance benchmarking

4. **📚 Documentation**
   - API documentation
   - User guides
   - Architecture deep-dives

### Getting Started Checklist

- [ ] Set up development environment
- [ ] Run existing tests: `pnpm test`
- [ ] Explore the codebase structure
- [ ] Try the mock MCP server: `node scripts/mock-mcp-server.mjs`
- [ ] Read existing issues and discussions
- [ ] Pick a good first issue labeled `good-first-issue`

## 🔍 Key Files to Understand

| File | Purpose | When to Modify |
|------|---------|----------------|
| `src/main/tipc.ts` | IPC API router | Adding new API endpoints |
| `src/main/mcp-service.ts` | MCP client implementation | MCP-related features |
| `src/main/llm.ts` | LLM processing & agent mode | AI processing logic |
| `src/main/keyboard.ts` | Keyboard event handling | Shortcut modifications |
| `src/renderer/src/components/agent-progress.tsx` | Real-time agent UI | Agent feedback improvements |
| `src/shared/types.ts` | Shared type definitions | Adding new data structures |

## 📞 Getting Help

- **Issues**: Check existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Refer to `docs/` folder for detailed guides
- **Testing**: See `docs/MCP_TESTING.md` for MCP testing setup

---

Ready to contribute? Pick an issue, follow the development workflow, and help make SpeakMCP even better! 🚀
