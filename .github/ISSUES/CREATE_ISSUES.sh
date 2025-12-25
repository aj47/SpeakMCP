#!/bin/bash
# Script to create GitHub issues from markdown files
# Requires: gh CLI authenticated (run: gh auth login)
#
# Usage: ./CREATE_ISSUES.sh

set -e

REPO="aj47/SpeakMCP"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if gh is available
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed."
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub CLI."
    echo "Run: gh auth login"
    exit 1
fi

echo "Creating issues for repository: $REPO"
echo "========================================="

# Process each markdown file
for file in "$SCRIPT_DIR"/*.md; do
    if [[ -f "$file" && "$file" != *"CREATE_ISSUES"* ]]; then
        filename=$(basename "$file")

        # Extract title from first line (remove # prefix)
        title=$(head -1 "$file" | sed 's/^# //')

        # Extract body (everything after first line)
        body=$(tail -n +3 "$file")

        # Extract labels from the Labels section
        labels=""
        if grep -q "## Labels" "$file"; then
            labels_line=$(grep -A1 "## Labels" "$file" | tail -1)
            # Convert backtick-separated labels to comma-separated
            labels=$(echo "$labels_line" | sed 's/`//g' | sed 's/, /,/g')
        fi

        echo ""
        echo "Creating issue: $title"
        echo "Labels: $labels"

        if [[ -n "$labels" ]]; then
            gh issue create \
                --repo "$REPO" \
                --title "$title" \
                --body "$body" \
                --label "$labels"
        else
            gh issue create \
                --repo "$REPO" \
                --title "$title" \
                --body "$body"
        fi

        echo "✓ Created: $title"
    fi
done

echo ""
echo "========================================="
echo "All issues created successfully!"
echo "View at: https://github.com/$REPO/issues"
