# Autonomous UI/UX Audit Agent

This directory contains scripts for running autonomous UI/UX audits on the SpeakMCP application using the Claude Agent SDK.

## Overview

The audit agent system:
- Automatically tests UI/UX flows defined in `AUDIT.md`
- Identifies issues based on best practices and accessibility standards
- **Autonomously fixes** issues in the source code
- Commits and pushes changes to the repository
- Logs all findings and actions
- Runs continuously every 30 minutes

## Files

- **`audit-agent.ts`** - Main agent script that performs audits
- **`audit-scheduler.ts`** - Scheduler that runs the agent every 30 minutes
- **`AUDIT_AGENT_README.md`** - This file

## Prerequisites

1. **Claude API Key**: Set your Anthropic API key as an environment variable:
   ```bash
   export ANTHROPIC_API_KEY="your-api-key-here"
   ```

2. **Dependencies**: Install required dependencies:
   ```bash
   pnpm run audit:install
   ```

3. **Git Configuration**: Ensure git is configured with your credentials for automatic commits.

## Usage

### Run a Single Audit

Test one flow and exit:

```bash
pnpm run audit:agent
```

This will:
1. Find the next pending flow in `AUDIT.md` (prioritized by Critical > High > Medium > Low)
2. Run the audit agent to test that flow
3. Fix any issues found
4. Update `AUDIT.md` with results
5. Exit

### Run Continuous Audits (Every 30 Minutes)

Start the scheduler to run audits continuously:

```bash
pnpm run audit:scheduler
```

This will:
1. Run an audit immediately
2. Schedule subsequent audits every 30 minutes
3. Continue until stopped with Ctrl+C

### Run in Background

To run the scheduler as a background process:

```bash
nohup pnpm run audit:scheduler > audit-scheduler.out 2>&1 &
```

Monitor the logs:
```bash
tail -f audit-scheduler.log
tail -f audit-agent.log
```

Stop the background process:
```bash
pkill -f "audit-scheduler"
```

## How It Works

### 1. Flow Selection

The agent reads `AUDIT.md` and finds the next pending flow using priority:
- **Critical** - System-critical functionality (agent kill switch, etc.)
- **High** - Core user-facing features (settings, MCP servers, hotkeys)
- **Medium** - Important but not critical features
- **Low** - Nice-to-have improvements

### 2. Autonomous Testing

The agent:
- Builds the application if needed
- Analyzes the code for the specific flow
- Checks against UI/UX requirements and best practices
- Tests expected behaviors
- Identifies ANY issues (accessibility, usability, consistency, performance)

### 3. Autonomous Fixing

When issues are found, the agent:
- **Immediately fixes** them in the source code
- Runs tests to ensure no regressions
- Follows established patterns in the codebase
- Makes commits with descriptive messages

### 4. Results Logging

The agent updates `AUDIT.md` with:
- ✅ **Passed** - No issues found
- 🔧 **Fixed** - Issues found and fixed
- ❌ **Failed** - Issues found but couldn't be fixed

And logs:
- Issues found
- Fixes applied
- Commit hash
- Test duration
- API cost

## Configuration

### Agent Settings

Edit `audit-agent.ts` to adjust:

```typescript
// Cost limits
maxTurns: 50,              // Max conversation turns
maxBudgetUsd: 5,           // Max cost per run ($5)

// Model selection
model: "claude-sonnet-4-5", // Fast and accurate
// model: "claude-opus-4-5",  // More thorough but slower/expensive
```

### Scheduling Interval

Edit `audit-scheduler.ts` to change the interval:

```typescript
const thirtyMinutes = 30 * 60 * 1000; // 30 minutes
// const oneHour = 60 * 60 * 1000;    // 1 hour
// const twoHours = 2 * 60 * 60 * 1000; // 2 hours
```

## Best Practices

### For Effective Audits

1. **Keep AUDIT.md updated** - Add new flows as features are developed
2. **Review commits** - The agent makes autonomous decisions, review them periodically
3. **Set cost limits** - Adjust `maxBudgetUsd` based on your budget
4. **Monitor logs** - Check `audit-agent.log` for issues
5. **Run manually first** - Test with `pnpm run audit:agent` before scheduling

### For Writing Flows in AUDIT.md

Each flow should have:
- **Clear description** - What exactly to test
- **Expected behavior** - What should happen
- **UI/UX requirements** - Specific standards to check (contrast, spacing, etc.)
- **Appropriate priority** - Critical/High/Medium/Low

Example:

```markdown
#### 22. New Feature Flow
**Status:** ⏳ Pending
**Priority:** High
**Description:** Test the new feature XYZ
**Expected Behavior:**
- Feature should activate with hotkey
- Visual feedback should be immediate
- Errors should display helpful messages

**UI/UX Requirements:**
- WCAG 2.1 AA compliance
- Consistent with existing design patterns
- Clear keyboard navigation
- Proper error handling

**Last Tested:** Never
**Issues Found:** -
**Fixes Applied:** -
```

## Safety Features

The agent has built-in safety mechanisms:

1. **Cost caps** - Stops after `maxBudgetUsd` is reached ($5 by default)
2. **Turn limits** - Stops after `maxTurns` (50 by default)
3. **Test validation** - Runs tests before committing
4. **Graceful failures** - Marks flows as failed rather than crashing
5. **Detailed logging** - All actions are logged for review

## Troubleshooting

### Agent Not Finding Flows

**Issue**: "No pending flows found"

**Solution**: Check AUDIT.md - ensure flows are marked with `⏳ Pending`

### Agent Not Making Commits

**Issue**: No git commits after fixing issues

**Solution**:
1. Check git configuration: `git config --list`
2. Ensure you have commit permissions
3. Check logs for errors

### High API Costs

**Issue**: Running out of budget

**Solution**:
1. Reduce `maxBudgetUsd` in `audit-agent.ts`
2. Increase scheduling interval
3. Use `claude-sonnet-4-5` instead of `claude-opus-4-5`

### Agent Asking Questions

**Issue**: Agent pausing for user input

**Solution**: This shouldn't happen with `permissionMode: "bypassPermissions"`. If it does:
1. Check the agent script configuration
2. Ensure `allowDangerouslySkipPermissions: true` is set
3. Review the prompt - it should emphasize autonomous operation

### Tests Failing After Fixes

**Issue**: Tests fail after agent makes changes

**Solution**:
1. Review the commit to understand what changed
2. Check if tests need updating
3. The agent should handle this, but manual intervention may be needed

## Logs

### audit-agent.log

Contains detailed logs from each audit run:
- Flow selection
- Agent actions
- Issues found
- Fixes applied
- Test results
- Costs and metrics

### audit-scheduler.log

Contains scheduler events:
- Start/stop times
- Run triggers
- Agent completion status
- Error summaries

## Environment Variables

Optional environment variables:

```bash
# Required
export ANTHROPIC_API_KEY="your-api-key"

# Optional
export AUDIT_AGENT_MAX_BUDGET=5      # Max cost per run (USD)
export AUDIT_AGENT_MAX_TURNS=50       # Max conversation turns
export AUDIT_AGENT_MODEL="claude-sonnet-4-5"  # Model to use
export AUDIT_INTERVAL_MINUTES=30      # Scheduling interval
```

## Production Deployment

### Using systemd (Linux)

Create `/etc/systemd/system/speakmcp-audit.service`:

```ini
[Unit]
Description=SpeakMCP Autonomous Audit Agent
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/SpeakMCP-Workspaces/slot-1
Environment="ANTHROPIC_API_KEY=your-api-key"
ExecStart=/usr/bin/pnpm run audit:scheduler
Restart=on-failure
RestartSec=300
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable speakmcp-audit
sudo systemctl start speakmcp-audit
sudo systemctl status speakmcp-audit
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY . .

RUN npm install -g pnpm@9.12.1
RUN pnpm install
RUN pnpm run audit:install

CMD ["pnpm", "run", "audit:scheduler"]
```

Build and run:

```bash
docker build -t speakmcp-audit .
docker run -d \
  --name speakmcp-audit \
  -e ANTHROPIC_API_KEY="your-api-key" \
  -v $(pwd)/AUDIT.md:/app/AUDIT.md \
  -v $(pwd)/audit-agent.log:/app/audit-agent.log \
  speakmcp-audit
```

### Using PM2

Install PM2:
```bash
npm install -g pm2
```

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'speakmcp-audit',
    script: 'pnpm',
    args: 'run audit:scheduler',
    cwd: '/path/to/SpeakMCP-Workspaces/slot-1',
    env: {
      ANTHROPIC_API_KEY: 'your-api-key'
    },
    restart_delay: 300000, // 5 minutes
    max_restarts: 10
  }]
};
```

Start:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Monitoring & Alerts

### Log Monitoring

Watch for errors in real-time:

```bash
tail -f audit-agent.log | grep -i error
```

### Slack/Discord Notifications

Add to `audit-agent.ts`:

```typescript
async function sendNotification(message: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
  }
}
```

### Cost Tracking

Monitor API costs in `audit-agent.log`:

```bash
grep "Total cost" audit-agent.log | tail -20
```

## Advanced Usage

### Custom MCP Tools

The agent can use iTerm MCP for interactive testing:

```typescript
allowedTools: [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep",
  // Add MCP tools here when needed
],
```

### Parallel Testing

Run multiple agents in parallel (requires careful coordination):

```bash
# Terminal 1
AUDIT_FLOW_NUMBER=1 pnpm run audit:agent

# Terminal 2
AUDIT_FLOW_NUMBER=2 pnpm run audit:agent
```

### Custom Prompts

Modify the agent prompt in `audit-agent.ts` for specific focus areas:

```typescript
const agentPrompt = `
Test Flow #${flow.number}: "${flow.name}"

EXTRA FOCUS: Check for performance regressions and memory leaks
...
`;
```

## FAQ

**Q: Will the agent break my code?**
A: The agent runs tests after making changes. Review commits regularly. Use feature branches for safety.

**Q: How much does this cost?**
A: With Sonnet 4.5, approximately $0.10-$0.50 per flow (depending on complexity). Max $5 per run.

**Q: Can I pause the scheduler?**
A: Yes, press Ctrl+C or `pkill -f audit-scheduler`.

**Q: What if the agent gets stuck?**
A: It has timeout mechanisms. Check logs and restart if needed.

**Q: Can I use this for other projects?**
A: Yes! Adapt `AUDIT.md` and the agent prompts to your needs.

## Support

For issues or questions:
1. Check logs first (`audit-agent.log`)
2. Review AUDIT.md for configuration issues
3. Open an issue on GitHub
4. Contact the team

## License

Same as SpeakMCP project.
