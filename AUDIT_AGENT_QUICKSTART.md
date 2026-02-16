# Autonomous UI/UX Audit Agent - Quick Start

This project includes an autonomous agent that continuously tests and improves the UI/UX of the SpeakMCP application.

## What It Does

The audit agent:
- ✅ **Automatically tests** 21 predefined UI/UX flows
- 🔍 **Identifies issues** based on WCAG 2.1 AA standards and best practices
- 🔧 **Fixes issues autonomously** without human intervention
- 📝 **Commits and pushes** changes to the repository
- 🔄 **Runs every 30 minutes** continuously
- 💰 **Cost-capped** at $5 per run to prevent runaway expenses

## Quick Setup (5 minutes)

### 1. Run the setup script

```bash
cd /Users/ajjoobandi/Development/SpeakMCP-Workspaces/slot-1
./scripts/setup-audit-agent.sh
```

This will:
- Check prerequisites (Node.js, pnpm)
- Install dependencies
- Create `.env.audit` configuration file

### 2. Configure your API key

Get your API key from https://console.anthropic.com/ then:

```bash
# Edit .env.audit
nano .env.audit

# Or export directly
export ANTHROPIC_API_KEY="your-api-key-here"
```

### 3. Run your first audit

Test a single flow:

```bash
source .env.audit
pnpm run audit:agent
```

This will test the highest priority pending flow from `AUDIT.md`.

### 4. Start continuous auditing

Run every 30 minutes:

```bash
source .env.audit
pnpm run audit:scheduler
```

Or run in background:

```bash
source .env.audit
nohup pnpm run audit:scheduler > audit-scheduler.out 2>&1 &
```

## What Gets Tested?

See `AUDIT.md` for the complete list of 21 test flows, including:

### Critical Flows
- Agent kill switch functionality
- Emergency stop mechanisms

### High Priority Flows
- Settings tab navigation
- MCP server management
- Keyboard shortcuts
- Window focus behavior
- Agent progress tracking

### Medium Priority Flows
- Profile management
- Panel positioning
- Advanced settings

### And More...
- Accessibility (keyboard navigation, contrast)
- Error handling
- Performance under load

## Monitoring

### View logs in real-time

```bash
# Agent logs (detailed test results)
tail -f audit-agent.log

# Scheduler logs (timing and status)
tail -f audit-scheduler.log
```

### Check progress

```bash
# View AUDIT.md to see:
# - Which flows have been tested
# - Issues found and fixed
# - Coverage percentage
cat AUDIT.md
```

### Monitor costs

```bash
# See costs per run
grep "Total cost" audit-agent.log
```

## Safety Features

✅ **Cost limits** - Stops at $5 per run (configurable)
✅ **Test validation** - Runs tests before committing
✅ **Graceful errors** - Logs failures without crashing
✅ **Turn limits** - Max 50 conversation turns
✅ **No human approval needed** - Fully autonomous

## Stopping the Agent

Press `Ctrl+C` if running in foreground.

If running in background:

```bash
pkill -f "audit-scheduler"
```

## Full Documentation

For advanced configuration, production deployment, troubleshooting, and more:

📚 **Read:** `scripts/AUDIT_AGENT_README.md`

## Architecture

```
┌─────────────────────────────────────────┐
│  AUDIT.md                               │
│  - 21 test flows                        │
│  - Priorities & requirements            │
│  - Results tracking                     │
└───────────┬─────────────────────────────┘
            │
            v
┌─────────────────────────────────────────┐
│  audit-scheduler.ts                     │
│  - Runs every 30 minutes                │
│  - Spawns audit agent                   │
└───────────┬─────────────────────────────┘
            │
            v
┌─────────────────────────────────────────┐
│  audit-agent.ts                         │
│  - Finds next pending flow              │
│  - Tests using Claude Agent SDK         │
│  - Fixes issues autonomously            │
│  - Commits changes                      │
│  - Updates AUDIT.md                     │
└───────────┬─────────────────────────────┘
            │
            v
┌─────────────────────────────────────────┐
│  Your SpeakMCP Codebase                 │
│  - Source files edited                  │
│  - Tests run                            │
│  - Changes committed                    │
└─────────────────────────────────────────┘
```

## Example Output

```
[2026-02-09T17:00:00.000Z] === Starting audit for Flow #1: Settings Tab Navigation ===
[2026-02-09T17:00:00.000Z] Priority: High
[2026-02-09T17:00:05.000Z] Agent: Testing settings tab navigation...
[2026-02-09T17:00:15.000Z] Tool executed: Read
[2026-02-09T17:00:20.000Z] Agent: Found issue: Tab focus advances twice
[2026-02-09T17:00:25.000Z] Tool executed: Edit
[2026-02-09T17:00:30.000Z] Agent: Fixed duplicate Tab handling in settings.ts
[2026-02-09T17:00:35.000Z] Tool executed: Bash
[2026-02-09T17:00:45.000Z] Agent: Tests pass! Committing changes...
[2026-02-09T17:00:50.000Z] SUCCESS: Agent completed flow #1
[2026-02-09T17:00:50.000Z] Total cost: $0.23
[2026-02-09T17:00:50.000Z] Turns: 12
[2026-02-09T17:00:50.000Z] Updated AUDIT.md with results for flow #1
```

## FAQ

**Q: Will it break my code?**
A: The agent runs tests before committing. Review commits regularly. Consider using a feature branch.

**Q: How much does it cost?**
A: ~$0.10-$0.50 per flow with Sonnet 4.5. Capped at $5 per run.

**Q: Can I customize the tests?**
A: Yes! Edit `AUDIT.md` to add/modify flows. Edit `audit-agent.ts` to change behavior.

**Q: What if it gets stuck?**
A: It has timeout mechanisms. Check logs and restart if needed.

## Troubleshooting

### "No pending flows found"
➜ All flows have been tested! Add new flows to AUDIT.md or reset existing ones.

### "ANTHROPIC_API_KEY not set"
➜ Export your API key: `export ANTHROPIC_API_KEY="your-key"`

### "Dependencies not installed"
➜ Run: `pnpm run audit:install`

### "Permission denied"
➜ Make scripts executable: `chmod +x scripts/*.sh scripts/*.ts`

## Support

- 📖 Full docs: `scripts/AUDIT_AGENT_README.md`
- 📋 Test flows: `AUDIT.md`
- 📊 Logs: `audit-agent.log`, `audit-scheduler.log`
- 🐛 Issues: Open a GitHub issue
- 💬 Questions: Contact the team

## Next Steps

1. ✅ **Setup complete?** Run your first audit!
2. 📖 **Read full docs** for advanced features
3. 🔄 **Start scheduler** for continuous audits
4. 👀 **Monitor logs** to see it in action
5. ✏️ **Customize flows** in AUDIT.md for your needs

---

Happy auditing! 🚀
