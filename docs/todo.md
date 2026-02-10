# Orca - TODO

## Upstream Bugs

- [ ] **agent-deck `remove` silently fails when worktree is already gone** — `agent-deck remove <id>` reports "Removed session" (exit code 0) but does NOT actually delete the session from the DB when the session's worktree path no longer exists as a git worktree. Reproduction: (1) create a session with a worktree via `agent-deck add -w branch`, (2) manually remove the worktree outside of agent-deck (e.g. `git worktree remove`), (3) run `agent-deck remove <id>` — it prints "Removed session" but `agent-deck list` still shows it and the `instances` table still has the row. The worktree removal failure (`fatal: '/path' is not a working tree`) is printed as a "Warning" but causes the DB deletion to be silently skipped. Fix should be in agent-deck's remove logic: worktree cleanup failure should not prevent session DB deletion. Orca works around this by falling back to direct DB deletion. File a PR at the agent-deck repo.
