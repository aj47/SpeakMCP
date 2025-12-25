# [Refactor] Decompose mcp-config-manager.tsx into smaller components

## Problem

`mcp-config-manager.tsx` is **2,593 LOC** - one of the largest React components in the codebase. It handles:
- Server list display and management
- Add/edit server forms
- OAuth configuration
- Transport type selection
- Environment variables editing
- JSON import/export
- Server testing and validation
- Bulk enable/disable operations

This makes the component:
- Slow to load and render
- Difficult to test
- Hard to modify without side effects
- A merge conflict magnet

## Current State

The component contains:
- ~15 internal state variables
- ~20 handler functions
- ~10 sub-sections inline
- Mixed concerns (UI + business logic)

## Proposed Solution

Decompose into focused, testable components:

```
apps/desktop/src/renderer/src/components/mcp-config/
├── index.tsx                    # Main container (orchestration only)
├── ServerList.tsx               # List of configured servers
├── ServerListItem.tsx           # Individual server row
├── ServerEditor/
│   ├── index.tsx                # Add/edit form container
│   ├── BasicSettings.tsx        # Name, transport, command/URL
│   ├── EnvironmentVars.tsx      # Env var editor
│   ├── AdvancedSettings.tsx     # Timeout, headers, etc.
│   └── OAuthConfig.tsx          # OAuth-specific settings
├── ServerActions.tsx            # Test, restart, enable/disable
├── ImportExport.tsx             # JSON import/export
├── BulkOperations.tsx           # Select all, bulk toggle
└── hooks/
    ├── useServerConfig.ts       # Server CRUD operations
    ├── useServerTest.ts         # Connection testing
    └── useImportExport.ts       # Import/export logic
```

### Example Component Split

```tsx
// ServerList.tsx (~150 LOC)
export function ServerList({ servers, onSelect, onToggle }) {
  return (
    <div className="server-list">
      {servers.map(server => (
        <ServerListItem
          key={server.name}
          server={server}
          onSelect={() => onSelect(server)}
          onToggle={() => onToggle(server)}
        />
      ))}
    </div>
  )
}

// hooks/useServerConfig.ts (~100 LOC)
export function useServerConfig() {
  const addServer = async (config) => { ... }
  const updateServer = async (name, config) => { ... }
  const deleteServer = async (name) => { ... }
  return { addServer, updateServer, deleteServer }
}
```

## Benefits

- **Faster Rendering**: Smaller components = better React performance
- **Isolated Testing**: Test each component/hook independently
- **Reusability**: ServerListItem can be used elsewhere
- **Clear Data Flow**: Props-based communication
- **Easier Maintenance**: Change one feature without touching others

## Acceptance Criteria

- [ ] Create `mcp-config/` directory structure
- [ ] Extract ServerList component
- [ ] Extract ServerEditor with sub-components
- [ ] Extract hooks for business logic
- [ ] Extract ImportExport component
- [ ] Main index.tsx is orchestration only (~200 LOC max)
- [ ] Add component tests
- [ ] No component exceeds 400 LOC

## Labels

`refactor`, `tech-debt`, `ui`, `react`
