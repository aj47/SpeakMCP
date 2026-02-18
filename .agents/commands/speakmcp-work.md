Start work on GitHub issue #$ARGUMENTS

If no issue number is provided, find the next open UNASSIGNED GitHub issue that does not have a label 'slot-n' i.e slot-1, slot-2 etc

1) Read the issue and label it slot-n based on cwd so other slots know not to take the issue
2) Update terminal title to show issue number and folder name:
   - Run: export DISABLE_AUTO_TITLE="true" && echo -ne "\033]0;#${issue} - ${PWD##*/}\007"
   - Or for iTerm2, set tab title: echo -ne "\033]1;#${issue} - ${PWD##*/}\007"
   - Example output: "#123 - SpeakMCP-2"
3) Ensure a clean, up-to-date main in this workspace (cwd)
   - git checkout main
   - git fetch origin
   - git reset --hard origin/main
4) Create a feature/fix branch
   - issue=<number>   slug=<short-slug>
   - git checkout -b feature/${issue}-${slug}   # or: fix/${issue}-${slug}
5) Do the work here (in this cwd)
   - Use the context engine to gather necessary context
   - Commit in small chunks; run tests until green
   - Push branch: git push -u origin HEAD
6) Test changes with following this guide; apps/desktop/DEBUGGING.md
7) Open a PR into main labelled slot-n

Notes
- Prefer descriptive slugs (e.g., settings-dropdown)

