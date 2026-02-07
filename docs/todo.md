# Orca - TODO

## Future Improvements

- [ ] **Improve session summaries accuracy** - Current approach uses the JSONL `type=summary` entry and last assistant text as fallback. Consider: parsing more context from the conversation, using the `latest_prompt` from agent-deck `tool_data`, or combining multiple signals for a richer summary that better describes the project and current status.

- [ ] **Add worktree creation from session card** - For sessions that don't have a worktree (showing "no wt" badge), add the ability to create a worktree directly from the session card.

## Polish (Phase 5)

- [ ] Keyboard shortcuts (navigate sessions, open terminal, close panels)
- [ ] Proper error handling and loading states throughout
- [ ] App icon and window management
- [ ] xterm.js for full terminal emulation (current approach polls tmux capture-pane)
