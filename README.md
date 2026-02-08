<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Orca" width="128" height="128">
</p>

<h1 align="center">Orca</h1>

<p align="center">
A desktop app for managing parallel <a href="https://claude.ai/claude-code">Claude Code</a> sessions across repos and git worktrees.
</p>

---

Orca gives you at-a-glance visibility into all your Claude Code sessions — what each one is doing, which ones need your attention, and one-click access to terminals and worktree operations. Built on top of [agent-deck](https://github.com/nichochar/agent-deck).

## Features

- **Attention indicators** — Color-coded status for each session: needs input (red), error (orange), running (blue), idle (green), stale (gray)
- **"Needs Action" view** — A single view of every session waiting for you across all repos
- **Session summaries** — Auto-generated descriptions of what each session is working on, parsed from Claude Code logs
- **Integrated terminal** — Full xterm.js terminal with WebGL acceleration, embedded right in the app
- **Worktree management** — Create, diff, rebase, and merge git worktrees from session cards
- **Keyboard-driven** — Navigate sessions (`j`/`k`), switch groups (`0`-`9`), search (`/`), and more. Press `?` for the full list
- **Session organization** — Group sessions by repo/project, move between groups, rename, and filter

## Prerequisites

Orca requires the following tools to be installed:

- [agent-deck](https://github.com/nichochar/agent-deck) — manages the underlying sessions
- [tmux](https://github.com/tmux/tmux) — terminal multiplexing
- [git](https://git-scm.com/) — worktree operations
- [Claude Code](https://claude.ai/claude-code) — the AI coding assistant

## Installation

Orca currently needs to be built from source. Pre-built packages are planned.

### Requirements

- [Node.js](https://nodejs.org/) (for the frontend)
- [Rust](https://rustup.rs/) (for the Tauri backend)

### Build

```bash
git clone https://github.com/beaufour/orca.git
cd orca
npm install
npx tauri build
```

The built application will be in `src-tauri/target/release/`.

For development:

```bash
npx tauri dev
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Move focus between sessions |
| `Enter` | Open terminal for focused session |
| `Esc` | Close terminal / modal / search |
| `/` | Search sessions |
| `0`-`9` | Switch to group by number |
| `n` | New session |
| `d` | Remove focused session |
| `R` | Rename session |
| `m` | Move session to another group |
| `g` | Create new group |
| `?` | Show shortcuts help |
