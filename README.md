<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Orca" width="128" height="128">
</p>

<h1 align="center">Orca</h1>

<p align="center">
A desktop app for managing parallel <a href="https://claude.ai/claude-code">Claude Code</a> and <a href="https://github.com/sst/opencode">Opencode</a> sessions across repos and git worktrees.
</p>

---

Orca allows you to have many parallel Claude Code and Opencode sessions running at the same time, while giving you a view into what each one is doing, which ones need your attention, and one-click access to handy utils like a diff view and terminals. It is built on top of [agent-deck](https://github.com/asheshgoplani/agent-deck).

<p align="center">
  <img src="docs/imgs/app.png" alt="Orca screenshot" width="800">
</p>

## Status

This app is very much in development mode and is crafted for my workflow, but I'd wager it should work for most people.

Should you use it though? I don't know.

1. This is very much a "moment in time" tool. IDEs / other tools will surpass this little util
2. It is customized to what I want for my workflow and might not fit yours. Also, I'm sure there are assumptions about my setup that I've forgotten about...

All that said, I'm all ears for thoughts, feedback, etc.

## Features

- **Attention indicators** — Color-coded status for each session: needs input (red), error (orange), running (blue), idle (green), stale (gray)
- **"Needs Action" view** — A single view of every session waiting for you across all repos
- **Integrated terminal** — Full xterm.js terminal embedded right in the app
- **Worktree management** — Create, diff, rebase, and merge git worktrees from session cards. Supports custom worktree scripts for monorepos with sparse checkouts
- **Keyboard-driven** — Navigate sessions (`j`/`k`), switch groups (`0`-`9`), search (`/`), and more. Press `?` for the full list
- **Session organization** — Group sessions by repo/project, move between groups, rename, and filter
- **Remote OpenCode** — Connect to remote OpenCode servers via HTTP + SSE for chat-style sessions without local dependencies

## Backends

Orca supports two backends, configured per group:

- **Local** (default) — Sessions run on your machine via agent-deck + tmux. Supports Claude Code, OpenCode, and shell sessions with full terminal embedding and worktree management.
- **OpenCode Remote** — Connect to a remote OpenCode server over HTTP. Sessions run on the server with a chat-style message view in Orca. Configure via Group Settings with a server URL and password.

See [docs/backends.md](docs/backends.md) for architecture details.

## Prerequisites

For the **local** backend, Orca requires:

- [agent-deck](https://github.com/asheshgoplani/agent-deck) — manages the underlying sessions
- [tmux](https://github.com/tmux/tmux) — terminal multiplexing
- [git](https://git-scm.com/) — worktree operations
- [Claude Code](https://claude.ai/claude-code) — the AI coding assistant
- [Opencode](https://github.com/sst/opencode) — the AI coding assistant (also supported)

For the **opencode-remote** backend, only a reachable OpenCode server URL is needed.

## Installation

You can download the .dmg [here](../../releases) or build Orca yourself.

## Building

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
