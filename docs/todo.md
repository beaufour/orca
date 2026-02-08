# Orca - TODO

## Future Improvements

- [ ] **Improve session summaries accuracy** - Current approach uses the JSONL `type=summary` entry and last assistant text as fallback. Consider: parsing more context from the conversation, using the `latest_prompt` from agent-deck `tool_data`, or combining multiple signals for a richer summary that better describes the project and current status.

- [x] **Add worktree creation from session card** - For sessions that don't have a worktree (showing "no wt" badge), add the ability to create a worktree directly from the session card.

- [x] **Group attention indicators in sidebar** - Show markers/badges on each group in the sidebar indicating whether any session within that group needs action (needs_input, error). Gives at-a-glance visibility without having to click into each group.

- [x] **"Needs Action" virtual group** - Add a special group that aggregates all sessions across all repos/groups that currently need action (needs_input or error status). Provides a single view of everything requiring attention.

- [x] **Investigate embedded true terminal** - Researched native terminal embedding (Alacritty, Ghostty, SwiftTerm, etc.). Not feasible on macOS due to cross-process NSView limitations. Improved existing xterm.js: switched to Tauri Channels, added resize debouncing, set tmux window-size latest. See `docs/terminal-embedding-research.md`.

- [ ] **Keyboard shortcut help overlay** - Add a `?` key shortcut that shows an overlay listing all available keyboard shortcuts. Currently there's no way for users to discover them.

- [ ] **`d` shortcut to remove focused session** - Trigger the remove confirmation flow on the currently focused session card via keyboard. Requires lifting or bridging the confirm state from SessionCard.

- [ ] **Session management shortcuts (`g`, `m`, `R`)** - Mirror remaining agent-deck shortcuts: `g` to create a new group, `m` to move a session between groups, `R` to rename a session/group. Requires implementing the underlying features first.

- [ ] **Diff viewer** - Add a way to view git diffs for sessions/worktrees, showing what changed.

- [ ] **Terminal scroll storm when opening session with history** - Opening a tab that has terminal history causes excessive scrolling. Investigate whether we're auto-scrolling to bottom too aggressively or need to debounce/suppress scroll during initial attach.

- [ ] **Better handling of missing tmux session** - When a session's tmux session no longer exists (e.g. process died, tmux killed), the UI doesn't handle it well. Should detect the missing tmux session and show a clear message with option to restart.

- [ ] **Distribution (packaging and updating)** - Set up app packaging for macOS (DMG/pkg) and auto-update mechanism so users can install and stay current without building from source.

- [ ] **Welcome screen** - Add a first-run welcome screen that explains what Orca does: managing parallel Claude Code sessions across repos and git worktrees. Help new users understand the workflow and prerequisites (agent-deck, tmux, etc.).

- [ ] **README** - Write a user-facing README covering what Orca is, screenshots, installation, prerequisites, and basic usage. Not developer docs.

- [ ] **Tests** - Add test coverage for both the Rust backend (unit tests for git/tmux/agentdeck commands) and the React frontend (component tests).

- [ ] **Linters and formatting** - Set up ESLint, Prettier, clippy, and rustfmt with project configs. Enforce consistent code style.

- [ ] **CI on GitHub** - Set up GitHub Actions for automated builds, type checking (`tsc --noEmit`), `cargo build`/`cargo clippy`, linting, and tests on PRs.

- [ ] **"Show log" function** - Add a way to view the app log (Tauri/Rust log output) from within the UI. Useful for debugging issues without having to find the log file on disk.

- [ ] **General and group settings** - Add a settings UI for both app-wide and per-group configuration: preferred IDE, merge strategy (merge to local main/master vs raise PR), whether to create worktrees by default when adding sessions.

- [ ] **Show associated PR/issue** - Display linked GitHub PR or issue on session cards when available. Could parse from branch name conventions, git remote, or `gh` CLI.

- [ ] **Start session with initial prompt** - Allow providing a first prompt when creating a session so Claude can start working immediately. The prompt could double as the session description.

- [ ] **Larger session cards / task-list view** - Make session cards bigger to show more of the description. Consider treating the session list more like a task/to-do list with richer status and context.

- [ ] **PR/merge button with auto-close** - Add a button that kicks off a Claude session to handle PR creation or merge. If no problems, auto-close the session; if issues arise, open a new session to address them.

- [ ] **Terminal opens with extra newlines after prompt** - When opening an existing session's terminal, the cursor often ends up on a blank line below the actual prompt (e.g. `>` is visible but cursor is a line or two below it). Likely caused by extra newlines being sent during the attach/resize handshake with tmux. Investigate whether the initial PTY attach or resize is injecting blank lines.

- [ ] **Visual indicator for terminal focus** - Make it obvious when the terminal view has focus (and is capturing keystrokes). Currently there's no visual difference, which is confusing since keyboard shortcuts behave differently. Consider a border highlight, header color change, or focus badge.

- [ ] **System notifications for attention needed** - Send native OS notifications when a session transitions to needs_input or error status, so the user doesn't have to keep Orca in the foreground to notice.

- [ ] **Open terminal in session directory** - Add a button/shortcut to open a system terminal (e.g. Terminal.app, iTerm) in the session's project or worktree directory for manual work outside of Claude.

- [ ] **Remove session safety logic** - Define clear rules for session removal: should we allow removing a worktree with unmerged branches? With uncommitted changes? Currently removal can leave behind orphaned branches and uncommitted work. Add pre-removal checks (dirty working tree, unmerged branch, unpushed commits) and either warn/block or offer to clean up. Goal: prevent accumulation of orphaned branches and lost work.

- [ ] **Agent-deck version tracking** - Maintain a log of which agent-deck versions Orca supports. Document the current version's CLI interface, DB schema, and behaviors we depend on. When a new agent-deck version is released, diff against the documented version to identify breaking changes and adjust our logic (CLI args, DB queries, output parsing, etc.).

## Upstream Bugs

- [ ] **agent-deck `remove` silently fails when worktree is already gone** — `agent-deck remove <id>` reports "Removed session" (exit code 0) but does NOT actually delete the session from the DB when the session's worktree path no longer exists as a git worktree. Reproduction: (1) create a session with a worktree via `agent-deck add -w branch`, (2) manually remove the worktree outside of agent-deck (e.g. `git worktree remove`), (3) run `agent-deck remove <id>` — it prints "Removed session" but `agent-deck list` still shows it and the `instances` table still has the row. The worktree removal failure (`fatal: '/path' is not a working tree`) is printed as a "Warning" but causes the DB deletion to be silently skipped. Fix should be in agent-deck's remove logic: worktree cleanup failure should not prevent session DB deletion. Orca works around this by falling back to direct DB deletion. File a PR at the agent-deck repo.

## Polish (Phase 5)

- [x] Keyboard shortcuts (navigate sessions, open terminal, close panels)
- [x] Proper error handling and loading states throughout
- [x] App icon and window management
- [x] xterm.js for full terminal emulation (replaced tmux capture-pane polling)
