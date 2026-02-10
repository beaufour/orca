# Orca - TODO

## Future Improvements

- [ ] **Show associated PR/issue** - Display linked GitHub PR or issue on session cards when available. Could parse from branch name conventions, git remote, or `gh` CLI.

- [ ] **Larger session cards / task-list view** - Make session cards bigger to show more of the description. Consider treating the session list more like a task/to-do list with richer status and context.

- [ ] **System notifications for attention needed** - Send native OS notifications when a session transitions to needs_input or error status, so the user doesn't have to keep Orca in the foreground to notice.

- [ ] **Agent-deck version tracking** - Maintain a log of which agent-deck versions Orca supports. Document the current version's CLI interface, DB schema, and behaviors we depend on. When a new agent-deck version is released, diff against the documented version to identify breaking changes and adjust our logic (CLI args, DB queries, output parsing, etc.).

- [ ] **More logging** - Add more detailed logging throughout the Rust backend for git operations, tmux interactions, agent-deck commands, and error cases. This will help with debugging and understanding the app's behavior in production.

- [ ] Make it possible to comment on lines in the diff. That context and the comment will be sent to the claude code prompt in the session

## Upstream Bugs

- [ ] **agent-deck `remove` silently fails when worktree is already gone** — `agent-deck remove <id>` reports "Removed session" (exit code 0) but does NOT actually delete the session from the DB when the session's worktree path no longer exists as a git worktree. Reproduction: (1) create a session with a worktree via `agent-deck add -w branch`, (2) manually remove the worktree outside of agent-deck (e.g. `git worktree remove`), (3) run `agent-deck remove <id>` — it prints "Removed session" but `agent-deck list` still shows it and the `instances` table still has the row. The worktree removal failure (`fatal: '/path' is not a working tree`) is printed as a "Warning" but causes the DB deletion to be silently skipped. Fix should be in agent-deck's remove logic: worktree cleanup failure should not prevent session DB deletion. Orca works around this by falling back to direct DB deletion. File a PR at the agent-deck repo.
