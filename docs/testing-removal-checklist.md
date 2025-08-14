# Testing Removal Checklist

This document enumerates all testing-related files, references, and dependencies to remove, plus secondary places to update, to fully strip testing from the repository.

## Summary of what to remove/update

- Test frameworks/configs: Vitest and Jest
- Test setup files and global type augmentations
- All test files and test-only utilities/mocks
- Testing documentation
- Testing devDependencies
- Any test scripts in package.json (none exist currently) and references in README
- Lint/TS configs that reference test tooling (if any)

---

## Files to delete (configs and setup)

- vitest.config.ts
- jest.config.js
- src/test/setup.ts (Vitest setup)
- src/setupTests.ts (Jest setup)

## Global type augmentations to delete or clean

- src/renderer/src/types/global.d.ts
  - Currently imports testing globals:
    - `import "@testing-library/jest-dom"`
    - `import "vitest/globals"`
  - Also augments `jest.Matchers`. If removing testing entirely, delete this file or strip all test-specific imports and declarations.

## Test files and directories to delete

- src/main/__tests__/ (entire directory)
  - src/main/__tests__/mcp-path-resolution.test.ts
  - src/main/__tests__/mcp-e2e.test.ts
  - src/main/__tests__/mcp-service.test.ts (mentioned in docs; verify existence and remove if present)
  - src/main/__tests__/mcp-config-validation.test.ts (mentioned in docs; verify existence and remove if present)
- src/renderer/src/components/__tests__/ (entire directory)
  - src/renderer/src/components/__tests__/agent-progress.test.tsx
  - src/renderer/src/components/__tests__/mcp-config-manager.test.tsx
- src/test/
  - src/test/keyboard.test.ts
  - src/test/setup.ts (listed above under setup)
  - src/test/mocks/mock-mcp-server.ts (mentioned in docs; verify/remove if present)
- Any remaining test files by pattern (double-check):
  - src/**/*.test.ts
  - src/**/*.test.tsx
  - src/**/*.spec.ts
  - src/**/*.spec.tsx

## Test-only or test-support scripts to delete (if removing all testing infra)

- scripts/mock-mcp-server.mjs
- scripts/test-mcp-path-fix.mjs

Note: These are used by the testing docs and manual test steps. If you still want manual troubleshooting scripts, keep them; otherwise delete.

## Documentation to update/remove

- docs/MCP_TESTING.md — delete entirely
- README.md — remove the "Testing" section (currently lists typecheck and lint under Testing). Consider moving `pnpm typecheck` and `pnpm lint` under a "Developer Tasks" or similar section instead.

## Package.json cleanup

- Remove devDependencies related to testing (use package manager):
  - vitest
  - @vitest/ui
  - @vitest/coverage-v8
  - @testing-library/react
  - @testing-library/user-event
  - @testing-library/jest-dom
  - jsdom
  - @types/jest
  - ts-jest (not present now, but remove if added later)
- Scripts: No `test` script currently defined. No change required, but ensure no docs reference `npm test`/`pnpm test`.

## ESLint/Prettier/Other configs

- Check .eslintrc.* (not included in this checklist’s retrieval):
  - Remove any `env` settings for jest/vitest
  - Remove any jest/vitest plugins or overrides
- Prettier: typically unaffected

## TypeScript configs

- tsconfig.web.json / tsconfig.node.json / tsconfig.json:
  - Ensure no test-only `types` are referenced (e.g., `vitest/globals`). If present, remove.
  - These files currently do not include test-only types in compilerOptions, but confirm after deleting src/renderer/src/types/global.d.ts.

## Code references and attributes

- Imports/usages to remove if present in non-test code (verify none remain after file deletions):
  - `vitest`, `jest`, `@testing-library/*`, `jsdom`
- data-testid attributes:
  - Found primarily in test files (e.g., mocked icons within tests). If any data-testid attributes exist in runtime components, you may optionally remove them for a fully clean runtime.

## Verification steps (post-removal)

1) Remove files listed above
2) Remove devDependencies via package manager:
   - pnpm remove -D vitest @vitest/ui @vitest/coverage-v8 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @types/jest ts-jest
3) Run:
   - pnpm install
   - pnpm typecheck
   - pnpm build
   - pnpm lint
4) Sanity run:
   - pnpm dev
5) If any TS errors complain about missing testing globals, search for residual references and delete them (especially in global.d.ts or stray imports)

## Appendix: Context snippets

- vitest.config.ts references jsdom and src/test/setup.ts
- jest.config.js references src/setupTests.ts and test match patterns
- src/renderer/src/types/global.d.ts imports `@testing-library/jest-dom` and `vitest/globals`
- docs/MCP_TESTING.md lists test files and mock scripts that should be removed if decommissioning testing

This checklist is exhaustive based on current repository state and should allow developers to remove all testing-related elements safely and consistently.

