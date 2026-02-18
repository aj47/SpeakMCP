---
description: Address PR review comments and make corrections
argument-hint: <pr-number>
---

We have new comments on PR #$ARGUMENTS.

1. First fetch the PR comments using `gh pr view $ARGUMENTS --comments` or the GitHub API
2. Check to see if the comments are valid by using context engine calls
3. Make a task list plan for solving the valid comments after first suggesting multiple fixes and then choosing the most recommended solution
4. Spawn subagents to work on any of the tasks that can be worked on in parallel without conflicts
5. Make commits to the PR for each solution
6. After all commits are pushed, comment "augment review" on the PR
