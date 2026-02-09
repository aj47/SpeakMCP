# CLI Parity Runner

This folder contains the non-blocking parity verification loops for CLI vs desktop-equivalent API behavior.

## Commands

- Full run:
  - `pnpm --filter @speakmcp/cli parity:full`
- Smoke run:
  - `pnpm --filter @speakmcp/cli parity:smoke`

## Required env

- `SPEAKMCP_PARITY_API_KEY` (preferred) or `SPEAKMCP_API_KEY`
- Optional targets:
  - `SPEAKMCP_PARITY_CLI_URL` (default: `http://127.0.0.1:3210`)
  - `SPEAKMCP_PARITY_DESKTOP_URL` (default: same as CLI target)

## Outputs

- Machine report: `apps/cli/parity/reports/parity-report.json`
- Human report: `apps/cli/parity/reports/parity-report.md`
- UX loop log: `~/.speakmcp/logs/cli-ux-regression.jsonl`

## Notes

- The settings roundtrip scenario intentionally toggles/restores `ttsEnabled` instead of numeric fields. This avoids false failures when persisted numeric settings are out of current validation bounds.
- Cloudflare connection parity is treated as a terminal-equivalent flow: CLI should render the Cloudflare connect QR in terminal and provide URL handoff actions.
