# Remove AI code slop

Remove all AI generated slop introduced in this codebase using subagents.

This includes:
- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file

when finished make a PR into main with the changes
