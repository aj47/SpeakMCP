# Context Overflow Fix - Implementation Summary

## Problem
Agent sessions were failing due to context budget overflow when fetching GitHub issues and pull requests. The context grew from 7,590 tokens to 76,719 tokens (10x increase), exceeding the model's 64,000 token limit. Even after 3-tier shrinking, context remained at 69,451 tokens (108% of limit), causing automatic session termination.

## Root Causes
1. **Massive GitHub API Responses**: GitHub API returns full JSON objects with all metadata fields (urls, avatars, labels, reactions, etc.)
2. **No Response Filtering**: Tool results were added to conversation history verbatim without filtering
3. **Ineffective Shrinking**: Existing 3-tier shrinking strategy couldn't handle the massive payloads fast enough

## Solutions Implemented

### 1. GitHub Response Filtering (`src/main/mcp-service.ts`)

Added `filterToolResponse()` method that:
- **Strips unnecessary fields** from GitHub API responses
- **Keeps only essential data**: number, title, state, html_url, created_at, updated_at, user.login, labels
- **Truncates large bodies** to 500 characters
- **Applies to**: `list_issues`, `list_pull_requests`, `get_issue`, `get_pull_request`
- **Fallback truncation**: Any response > 10,000 chars is truncated with a note

**Example reduction**:
```
Before: ~50KB per issue (with all metadata)
After: ~500 bytes per issue (essential fields only)
```

### 2. Aggressive Context Shrinking (`src/main/context-budget.ts`)

Added **Tier 0** - Aggressive Truncation:
- Runs BEFORE expensive LLM summarization calls
- Targets messages > 5,000 characters that look like tool results
- Truncates to 5,000 chars with explanatory note
- Saves time and prevents summarization of massive payloads

Enhanced **Tier 2** - Drop Middle:
- Now dynamically adjusts `lastN` based on context pressure
- If context > 150% of target, reduces `lastN` by 50%
- More aggressive message dropping when severely over budget

## Expected Impact

### Before Fix
- Query: "what are the open issues and pull requests"
- GitHub returns: 30 issues × 50KB = 1.5MB of JSON
- Context: 76,719 tokens (120% of limit)
- Result: ❌ Session terminated

### After Fix
- Query: "what are the open issues and pull requests"
- GitHub returns: 30 issues × 50KB = 1.5MB of JSON
- **Filtered to**: 30 issues × 500 bytes = 15KB
- Context: ~10,000 tokens (15% of limit)
- Result: ✅ Session completes successfully

## Testing Recommendations

1. **Test GitHub queries**:
   ```
   "what are the open issues and pull requests for speakmcp"
   "list all open issues"
   "show me recent pull requests"
   ```

2. **Monitor context usage** in logs:
   - Look for "ContextBudget: initial" and "after" messages
   - Verify token counts stay well below 64,000
   - Check that "aggressive_truncate" strategy is applied

3. **Verify response quality**:
   - Ensure filtered responses still contain all essential information
   - Confirm agent can answer questions about issues/PRs accurately

## Additional Improvements (Future)

1. **Proactive Context Monitoring**:
   - Warn at 50% of budget
   - Auto-summarize at 70%
   - Prevent tool calls that would exceed budget

2. **Fix Exa Server Connection**:
   - Investigate timeout issue (10000ms)
   - Increase timeout or fix underlying connection

3. **Model Upgrade**:
   - Consider models with larger context windows (e.g., Claude 3.5 Sonnet with 200K tokens)
   - Would provide more headroom for complex queries

## Files Modified

1. `src/main/mcp-service.ts`:
   - Added `filterToolResponse()` method (lines 707-782)
   - Integrated filtering into `executeServerTool()` (line 831)

2. `src/main/context-budget.ts`:
   - Added Tier 0 aggressive truncation (lines 192-214)
   - Enhanced Tier 2 with dynamic `lastN` adjustment (lines 244, 263)

## Rollback Instructions

If issues arise, revert changes to:
- `src/main/mcp-service.ts` (remove `filterToolResponse()` and its call)
- `src/main/context-budget.ts` (remove Tier 0 and dynamic `lastN` logic)

The system will fall back to original behavior (which may still fail on large GitHub queries).

