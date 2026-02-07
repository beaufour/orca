# Orca - Design Document

## Overview

Orca is a native desktop GUI (Tauri v2 + React) for managing parallel Claude Code sessions across multiple repos and git worktrees. It's built **on top of agent-deck** - not replacing it, but adding a visual layer with richer session information and worktree management.

**Problem**: When running 10+ parallel Claude Code sessions across repos and worktrees, it's hard to know which sessions need attention and what each one is doing. Agent-deck manages sessions well in the terminal but lacks summaries, attention indicators, and worktree management GUI.

**Approach**: Orca reads agent-deck's SQLite database (read-only) for session/group data, parses Claude Code JSONL logs for summaries and status, and adds git worktree management. Session creation goes through agent-deck's CLI.

## Architecture

```
+---------------------------------------------+
|              React Frontend                  |
|  +----------+ +-----------+ +------------+  |
|  | Sidebar  | | Session   | | Terminal   |  |
|  | (groups) | | Cards     | | (tmux)     |  |
|  +----------+ +-----------+ +------------+  |
+---------------------------------------------+
|           Tauri Commands (IPC)               |
+---------------------------------------------+
|              Rust Backend                    |
|  +----------+ +-----------+ +------------+  |
|  |agentdeck | | JSONL     | | Git/Tmux   |  |
|  |DB reader | | parser    | | commands   |  |
|  +----------+ +-----------+ +------------+  |
+---------------------------------------------+
|           External Dependencies              |
|  agent-deck DB    Claude Code logs    tmux   |
|  (read-only)      (~/.claude/)        git    |
+---------------------------------------------+
```

## Data Sources

1. **Agent-deck SQLite DB** (`~/.agent-deck/profiles/default/state.db`) - read-only
   - `instances` table: session list, tmux names, project paths, status, worktree info, tool_data (contains Claude session IDs)
   - `groups` table: folder/group organization
   - Poll every 3 seconds for sessions, 10 seconds for groups

2. **Claude Code JSONL logs** (`~/.claude/projects/-<encoded-path>/<session-id>.jsonl`)
   - Parse last 256KB for session summary and attention status
   - Link to agent-deck sessions via `tool_data.claude_session_id`
   - Path encoding: `/Users/foo/bar` becomes `-Users-foo-bar`

3. **tmux** - for terminal embedding (capture-pane, send-keys)

4. **agent-deck CLI** - for creating new sessions (`agent-deck add`)

## Project Structure

```
orca/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── src/
│       ├── main.rs
│       ├── lib.rs              # Tauri command registration
│       ├── agentdeck.rs        # Read agent-deck SQLite DB + create sessions
│       ├── claude_logs.rs      # Parse JSONL session logs
│       ├── git.rs              # Git worktree operations
│       ├── tmux.rs             # tmux capture-pane and send-keys
│       └── models.rs           # Shared data types
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles.css
│   ├── vite-env.d.ts
│   ├── types.ts                # TypeScript interfaces
│   └── components/
│       ├── Sidebar.tsx         # Repo groups list
│       ├── SessionList.tsx     # Session cards grid
│       ├── SessionCard.tsx     # Session: name, summary, status, worktree badge, actions
│       ├── AddSessionBar.tsx   # Create sessions (worktree/plain, claude/shell)
│       └── TerminalView.tsx    # tmux terminal viewer + input
├── docs/
│   ├── design.md               # This file
│   └── research.md             # Initial research on existing tools
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Rust Backend - Tauri Commands

### agentdeck.rs
- `get_groups() -> Vec<Group>` - Read groups table
- `get_sessions(group_path: Option<String>) -> Vec<Session>` - Read instances table, optionally filtered
- `create_session(project_path, group, title, tool, worktree_branch, new_branch) -> Result` - Shell out to `agent-deck add` CLI

### claude_logs.rs
- `get_session_summary(project_path, claude_session_id, agentdeck_status) -> SessionSummary`
  - Reads last 256KB of JSONL file
  - Extracts summary from `type=summary` entries
  - Extracts last assistant text as fallback
  - Determines attention status: needs_input, error, running, idle, stale, unknown
  - Uses agent-deck status as primary signal, refined by JSONL analysis

### git.rs
- `list_worktrees(repo_path) -> Vec<Worktree>` - `git worktree list --porcelain`
- `add_worktree(repo_path, branch) -> Result` - `git worktree add` with new branch
- `remove_worktree(repo_path, worktree_path) -> Result` - remove worktree + delete branch
- `merge_worktree(repo_path, branch, main_branch) -> Result` - merge into main, cleanup
- `rebase_worktree(worktree_path, main_branch) -> Result` - rebase on main

### tmux.rs
- `capture_pane(tmux_session) -> String` - Get last 200 lines of terminal output
- `send_keys(tmux_session, keys) -> Result` - Send input + Enter to session

## React Frontend

### Layout
```
+----------+------------------------------+
|          |  Session Cards               |
|  Groups  |  +--------+ +--------+      |
|          |  | title   | | title   |     |
|  > repo1 |  | summary | | summary |     |
|          |  | wt:feat | | no wt   |     |
|          |  | [actions]| |         |     |
|          |  +--------+ +--------+      |
|          |                              |
|          |  Terminal (click to open)    |
|          |  $ claude ...                |
|          |------------------------------+
|          |  [group] [+ Main] [+ Add]   |
+----------+------------------------------+
```

### Attention Status Badges
Derived from agent-deck status + JSONL log parsing:
- **Needs input** (red) - agent-deck status=waiting, or AskUserQuestion/ExitPlanMode tool use
- **Error** (orange) - agent-deck status=error, or is_error in tool result
- **Running** (blue) - agent-deck status=running
- **Idle** (green) - agent-deck status=idle, stop_reason=end_turn
- **Stale** (gray) - no activity for >1 hour

### Session Cards
Each card shows:
- Title + worktree badge (`wt:branch-name` or `no wt`)
- Summary text (from JSONL `type=summary` or last assistant text)
- Project path
- Attention status badge with colored left border
- For worktree sessions: Rebase/Merge/Remove action buttons
- Click to open terminal view

## Future TODOs
- Improve session summary accuracy (currently uses JSONL summary entry + last assistant text)
- Add worktree creation from existing non-worktree session cards
- Keyboard shortcuts
- Proper error handling and loading states
- App icon, window management

## Dependencies
- **Rust**: tauri, tauri-plugin-log, rusqlite (bundled), serde, serde_json, dirs
- **JS**: react, react-dom, @tanstack/react-query, @tauri-apps/api, typescript, vite
