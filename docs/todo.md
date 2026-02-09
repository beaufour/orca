# Orca - TODO

## Future Improvements

- [ ] **Improve session summaries accuracy** - Current approach uses the JSONL `type=summary` entry and last assistant text as fallback. Consider: parsing more context from the conversation, using the `latest_prompt` from agent-deck `tool_data`, or combining multiple signals for a richer summary that better describes the project and current status.

- [ ] **Distribution (packaging and updating)** - Set up app packaging for macOS (DMG/pkg) and auto-update mechanism so users can install and stay current without building from source.

- [ ] **Welcome screen** - Add a first-run welcome screen that explains what Orca does: managing parallel Claude Code sessions across repos and git worktrees. Help new users understand the workflow and prerequisites (agent-deck, tmux, etc.).

- [ ] **Tests** - Add test coverage for both the Rust backend (unit tests for git/tmux/agentdeck commands) and the React frontend (component tests).

- [ ] **CI on GitHub** - Set up GitHub Actions for automated builds, type checking (`tsc --noEmit`), `cargo build`/`cargo clippy`, linting, and tests on PRs.

- [ ] **General and group settings** - Add a settings UI for both app-wide and per-group configuration: preferred IDE, merge strategy (merge to local main/master vs raise PR), whether to create worktrees by default when adding sessions.

- [ ] Extend README.md with better description, assumed workflow, and screenshots.

- [ ] **Show associated PR/issue** - Display linked GitHub PR or issue on session cards when available. Could parse from branch name conventions, git remote, or `gh` CLI.

- [ ] **Larger session cards / task-list view** - Make session cards bigger to show more of the description. Consider treating the session list more like a task/to-do list with richer status and context.

- [ ] **System notifications for attention needed** - Send native OS notifications when a session transitions to needs_input or error status, so the user doesn't have to keep Orca in the foreground to notice.

- [ ] **Open terminal in session directory** - Add a button/shortcut to open a system terminal (e.g. Terminal.app, iTerm) in the session's project or worktree directory for manual work outside of Claude.

- [ ] **Agent-deck version tracking** - Maintain a log of which agent-deck versions Orca supports. Document the current version's CLI interface, DB schema, and behaviors we depend on. When a new agent-deck version is released, diff against the documented version to identify breaking changes and adjust our logic (CLI args, DB queries, output parsing, etc.).

- [ ] **More logging** - Add more detailed logging throughout the Rust backend for git operations, tmux interactions, agent-deck commands, and error cases. This will help with debugging and understanding the app's behavior in production.

- [ ] Make it possible to comment on lines in the diff. That context and the comment will be sent to the claude code prompt in the session

## Upstream Bugs

- [ ] **agent-deck `remove` silently fails when worktree is already gone** — `agent-deck remove <id>` reports "Removed session" (exit code 0) but does NOT actually delete the session from the DB when the session's worktree path no longer exists as a git worktree. Reproduction: (1) create a session with a worktree via `agent-deck add -w branch`, (2) manually remove the worktree outside of agent-deck (e.g. `git worktree remove`), (3) run `agent-deck remove <id>` — it prints "Removed session" but `agent-deck list` still shows it and the `instances` table still has the row. The worktree removal failure (`fatal: '/path' is not a working tree`) is printed as a "Warning" but causes the DB deletion to be silently skipped. Fix should be in agent-deck's remove logic: worktree cleanup failure should not prevent session DB deletion. Orca works around this by falling back to direct DB deletion. File a PR at the agent-deck repo.
