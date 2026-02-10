# Orca

GUI for managing parallel Claude Code sessions across repos and git worktrees. Built on top of agent-deck.

**This is a native desktop app (Tauri), not a web app. Do not use the Chrome DevTools MCP tools.**

## Tech Stack

- **Frontend**: React + TypeScript, Vite, TanStack Query
- **Backend**: Rust (Tauri v2), rusqlite, serde
- **External**: agent-deck (session management), tmux (terminal), git (worktrees)

## Project Structure

- `src/` - React frontend (components, types, styles)
- `src-tauri/src/` - Rust backend (Tauri commands)
- `docs/` - Design documents and TODOs

## Development

```bash
npm install                    # Install JS dependencies
npx tauri dev                  # Run in development mode (builds Rust + starts Vite)
cargo build --manifest-path src-tauri/Cargo.toml  # Build Rust only
npx tsc --noEmit               # TypeScript type check only
```

## Linting

**Prerequisites:** Run `npm install` first — all JS/TS checks (ESLint, Prettier, tsc) require node_modules to be installed.

A pre-commit hook runs all checks automatically. To set it up after cloning:

```bash
git config core.hooksPath .githooks
```

To run all checks manually:

```bash
npm run check                  # ESLint + Prettier + rustfmt + Clippy
```

To autofix:

```bash
npm run fix                    # ESLint --fix + Prettier --write + rustfmt
```

Always run `npm run check` before committing. The pre-commit hook will block commits that fail linting or formatting.

## Architecture

Orca reads agent-deck's SQLite DB (read-only) for session/group data, parses Claude Code JSONL logs for summaries and attention status, and shells out to `agent-deck add` for session creation. Terminal viewing uses tmux capture-pane.

## Key Files

- `src-tauri/src/agentdeck.rs` - Reads agent-deck DB, creates sessions via CLI
- `src-tauri/src/claude_logs.rs` - Parses JSONL logs for summaries/attention
- `src-tauri/src/git.rs` - Git worktree operations
- `src-tauri/src/tmux.rs` - Terminal capture and input
- `src/App.tsx` - Main app layout and state
- `src/components/SessionCard.tsx` - Session card with status, summary, worktree actions

## Conventions

- Dark theme with CSS custom properties (see `src/styles.css` `:root`)
- Attention status: needs_input (red), error (orange), running (blue), idle (green), stale (gray)
- Agent-deck DB path: `~/.agent-deck/profiles/default/state.db`
- Claude logs path: `~/.claude/projects/-<encoded-path>/<session-id>.jsonl`
