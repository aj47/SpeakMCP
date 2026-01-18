#!/bin/bash

ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  echo ""
  echo "=== Ralph Iteration $ITERATION ==="
  echo ""

  claude -p --dangerously-skip-permissions --output-format stream-json --verbose "$(cat apps/cli/PROMPT.md)" 2>&1 |
    tee /tmp/ralph_output.txt |
    jq -r '
      if .type == "assistant" then
        .message.content[]? |
        if .type == "text" then
          .text // empty
        elif .type == "tool_use" then
          "\n🔧 " + .name + ": " + (.input | tostring | .[0:100])
        else
          empty
        end
      elif .type == "user" then
        .message.content[]? |
        if .type == "tool_result" then
          "✓ tool done"
        else
          empty
        end
      else
        empty
      end
    ' 2>/dev/null

  if grep -q "RALPH_DONE" /tmp/ralph_output.txt; then
    echo ""
    echo "=== Complete! ==="
    exit 0
  fi

  sleep 2
done
