Start work on the next unassigned GitHub issue
MAKE SURE IT HAS NO ASSIGNEE
0) Assign it to yourself
1) Read the issue
2) Ensure a clean, up-to-date main in this workspace (cwd)
   - git checkout main
   - git fetch origin
   - git reset --hard origin/main
3) Create a feature/fix branch
   - issue=<number>   slug=<short-slug>
   - git checkout -b feature/${issue}-${slug}   # or: fix/${issue}-${slug}
4) Do the work here (in this cwd)
   - Use the context engine to gather necessary context
   - Commit in small chunks; run tests until green
   - Push branch: git push -u origin HEAD
5) Open a PR into main

Notes
- Prefer descriptive slugs (e.g., settings-dropdown)
