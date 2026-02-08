# Orca - Research & Product Brief

## Existing Tools Evaluated (2026-02-07)

### agent-deck (current workflow)

- Terminal-based tmux session manager for Claude Code
- Groups sessions by project
- No GUI - purely terminal/keyboard driven

### Claude Code Viewer (d-kimuson/claude-code-viewer)

- **Launch**: `npx @kimuson/claude-code-viewer@latest --port 3400`
- **Stars**: 860+
- **Type**: Web-based (Node.js + React)
- **Pros**: Easy setup, good session browsing/switching, conversation replay with tool calls, git diff viewer (compare any two commits with side-by-side colored diffs), cost tracking, export to HTML, file history snapshots
- **Cons**: No worktree management, no branch management UI
- **How it starts sessions**: Uses `@anthropic-ai/claude-code` SDK directly in Node.js

### Opcode (getAsterisk/opcode)

- **Launch**: Build from source (Rust/Tauri + Bun)
- **Stars**: 20.4k
- **Type**: Native desktop (Tauri/Rust) + web mode
- **Pros**: Polished UI, checkpoint system (create/restore/compare/fork), agents management, MCP server management, hooks editor, settings GUI (8 tabs), usage dashboard, CLAUDE.md editor, tabbed interface
- **Cons**: No worktree management, no native git diff viewer (diffs are checkpoint-based only), minimal git integration overall, heavy build process
- **How it starts sessions**: Shells out to `claude` binary with CLI flags, working directory = project path

### Key Gaps in Both Tools

- Neither supports git worktree creation/management
- Neither shows session summaries or "needs attention" status
- Both just list each worktree directory as a separate project entry with no relationship between them

## Product Brief

### What I want to build

A GUI tool (like agent-deck but clickable) for managing parallel Claude Code sessions across multiple repos and worktrees.

### Core Requirements

1. **Clickable GUI** - Not terminal-only like agent-deck. Web-based is fine.

2. **Repo groups with worktree management** - A "group" is tied to a repo. Within a group, it should be easy to:
   - Add a new worktree (creates branch + worktree)
   - Merge a worktree back (merge branch into main, clean up worktree)
   - Rebase a worktree (rebase branch on main)
   - Remove a worktree (delete branch + worktree)

3. **Session attention indicators** - Easy to see which sessions need my attention (e.g., waiting for input, errored, completed with questions, permission prompts)

4. **Session summaries** - Each session shows a 1-3 sentence summary of what it's about. Essential when running 10+ parallel sessions with days between checking them.
