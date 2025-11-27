# Complex Variable Names Report

## Summary
This report identifies complex, cryptic, or hard-to-understand variable names found in the SpeakMCP repository.

## Critical Issues

### 1. **Single/Double Letter Variables** (Most Problematic)
These are the most cryptic and should be renamed:

#### `src/main/mcp-service.ts` (Lines 746-777)
- **`pv`** - Represents `paramValue` (line 747)
  - Used in enum normalization logic
  - Should be: `paramValueStr` or `normalizedParamValue`

- **`ci`** - Represents case-insensitive match result (line 749)
  - Should be: `caseInsensitiveMatch` or `ciMatch`

- **`ev`** - Represents enum value in array iteration (line 749, 777)
  - Should be: `enumValue`

- **`syn`** - Represents synonym lookup result (line 775)
  - Should be: `synonymMatch` or `mappedSynonym`

#### `src/main/context-budget.ts` (Line 12)
- **`key()`** - Function name is too generic (line 12)
  - Should be: `getCacheKey()` or `buildProviderModelKey()`

- **`k`** - Cache key variable (line 64)
  - Should be: `cacheKey`

#### `src/main/llm.ts` (Line 46)
- **`tc`** - Represents tool call (line 46)
  - Should be: `toolCall`

- **`tr`** - Represents tool result (line 50)
  - Should be: `toolResult`

---

## Moderate Issues

### 2. **Abbreviated/Unclear Names**

#### `src/main/context-budget.ts`
- **`cfg`** (lines 60, 166) - Should be: `config`
- **`MAX_TOKENS_HINT`** (line 100) - Unclear purpose, should be: `SUMMARIZATION_TOKEN_HINT`
- **`CHUNK_SIZE`** (line 101) - Should be: `CONTENT_CHUNK_SIZE`
- **`p`** (line 140) - Loop variable, should be: `part` or `chunk`

#### `src/main/mcp-service.ts`
- **`cfg`** (lines 629, 681, 1654) - Should be: `config`
- **`toStr`** (line 746) - Should be: `convertToString` or `stringifyValue`

---

## Recommendations

### Priority 1 (Fix Immediately)
1. Rename `pv` → `paramValueStr`
2. Rename `ci` → `caseInsensitiveMatch`
3. Rename `ev` → `enumValue`
4. Rename `syn` → `synonymMatch`
5. Rename `tc` → `toolCall`
6. Rename `tr` → `toolResult`

### Priority 2 (Fix Soon)
1. Rename `key()` → `getCacheKey()`
2. Rename `k` → `cacheKey`
3. Replace `cfg` → `config` throughout
4. Rename `toStr()` → `convertToString()`

### Priority 3 (Nice to Have)
1. Clarify `MAX_TOKENS_HINT` purpose
2. Rename `p` → `chunk` in loops
3. Add JSDoc comments for unclear abbreviations

