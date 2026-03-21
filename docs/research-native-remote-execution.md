# Research: Claude Code Native Remote Execution

Date: 2026-03-21

## Context

Orca currently supports remote Claude Code sessions via its own `agent-remote` server, which wraps Claude Code in containers and exposes an AgentAPI (HTTP + SSE). This works well but requires self-hosting.

This document researches Claude Code's **native** remote execution features and whether Orca can integrate with them directly.

---

## Native Remote Execution Methods

### 1. `claude --remote` (Anthropic Cloud VMs)

**What it is:** Cloud-hosted coding sessions running on Anthropic-managed infrastructure.

**How it works:**
- `claude --remote "Your task description"` launches a task on an Anthropic cloud VM
- Repository is cloned to the cloud environment
- Tasks run asynchronously — continue even if you close the terminal
- Multiple tasks can run in parallel across different repos
- Also accessible via claude.ai/code web interface and mobile apps

**Session management:**
- Sessions visible at claude.ai/code, mobile apps, and Desktop app
- Can archive/delete sessions from the web interface
- `/teleport` moves a web session to a local terminal
- Cloud VMs include Node.js, Python, Ruby, Go, Rust, Java, PHP, PostgreSQL, Redis
- Custom setup scripts and environment variables supported
- Network access: configurable (limited allowlist by default, or full internet)

**API surface:** No documented programmatic API for managing cloud sessions. Interaction is through the CLI flag, web UI, or mobile apps. There is no known REST/HTTP endpoint that Orca could call directly to create, list, or interact with `--remote` sessions.

**Orca integration feasibility: Low (for now)**
- No public API to create/list/manage cloud sessions programmatically
- Would need to shell out to `claude --remote` and scrape output, which is fragile
- Could potentially watch `~/.claude/` for session state, but cloud sessions are managed server-side
- Worth revisiting if Anthropic exposes a REST API for cloud sessions

---

### 2. `claude remote-control` (Local Execution, Remote Access)

**What it is:** A sync layer that lets you access a local Claude Code session from any browser or mobile device.

**How it works:**
- `claude remote-control` starts a server mode that accepts remote connections
- `claude --remote-control` adds remote access to an interactive session
- `/remote-control` enables it mid-session
- Session runs entirely on the local machine — browser/phone is just a viewport
- All local tools, MCP servers, and project config remain available

**Server mode:**
- `claude remote-control` stays running, accepts multiple sessions
- `--spawn worktree` creates isolated git worktrees per session
- `--capacity N` limits concurrent sessions (default 32)
- Displays session URL and QR code for connecting

**Requirements:**
- Claude Code v2.1.51+
- OAuth authentication (not API keys)
- Pro, Max, Team, or Enterprise plan

**Orca integration feasibility: Medium**
- Orca could launch `claude remote-control` as a managed subprocess
- The session URL could be captured and displayed in the UI for mobile access
- However, this doesn't add much value — Orca already manages local sessions via agent-deck + tmux
- The main benefit would be exposing Orca-managed sessions to mobile devices
- Could be a nice "share session to phone" feature but not a core remote execution story

---

### 3. Claude Agent SDK (Programmatic API)

**What it is:** Python and TypeScript libraries for running Claude Code programmatically.

**How it works:**
- `pip install claude-agent-sdk` or `npm install @anthropic-ai/claude-agent-sdk`
- `query()` function returns an async iterator of messages
- Agent autonomously uses tools (Read, Write, Edit, Bash, Glob, Grep, etc.)
- Sessions can be resumed by ID

**Python example:**
```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Fix the bug in auth.py",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash"],
        cwd="/path/to/repo",
    ),
):
    print(message)
```

**Key capabilities:**
- Full tool suite (Read, Write, Edit, Bash, Glob, Grep, WebSearch, etc.)
- Session resume via session ID
- Hooks (PreToolUse, PostToolUse, Stop, etc.)
- MCP server integration
- Works with direct API, AWS Bedrock, Google Vertex AI, Azure Foundry

**Orca integration feasibility: High — this is the most promising path**

The Agent SDK could serve as an alternative to agent-deck + tmux for local session management:
- **Session creation**: `query()` replaces `agent-deck add`
- **Real-time monitoring**: Async iterator provides streaming messages (replaces JSONL parsing)
- **Session control**: Resume sessions, send follow-up messages
- **No tmux dependency**: Messages come through the SDK, not terminal capture
- **Structured output**: Get typed message objects instead of parsing JSONL

However, there are significant challenges:
- Orca's backend is Rust (Tauri), SDK is Python/TypeScript
- Would need to either:
  - (a) Run a Python/TypeScript sidecar process that Orca communicates with
  - (b) Shell out to a thin wrapper script
  - (c) Use the SDK's TypeScript version from a Node.js sidecar (Tauri supports sidecars)
- Loses agent-deck's group management, DB, and tmux integration
- Would be a parallel backend, not a replacement for the local backend

---

### 4. `claude -p` (Headless/Print Mode)

**What it is:** Non-interactive CLI mode for scripting and automation.

**How it works:**
- `claude -p "prompt"` runs to completion and outputs the result
- Output formats: `text`, `json`, `stream-json`
- Can resume sessions: `--resume <session-id>`
- Tool auto-approval: `--allowedTools "Bash,Read,Edit"`

**Orca integration feasibility: Medium**
- Could use `-p --output-format stream-json` to get structured streaming output
- Session resume enables multi-turn interactions
- Simpler than the Agent SDK — just shell out to the CLI
- But less control than the SDK (no hooks, limited event types)
- Could work as a lightweight alternative to the current agent-deck + tmux approach

---

### 5. SSH Sessions (Desktop App Only)

**What it is:** Desktop app feature to run Claude Code on remote machines via SSH.

**Orca integration feasibility: Low**
- This is a Desktop app feature, not a CLI/API feature
- No programmatic way to create SSH sessions
- Orca would need to implement its own SSH-based remote execution

---

### 6. GitHub/GitLab Actions

**What it is:** CI/CD integrations for running Claude Code in GitHub/GitLab pipelines.

**Orca integration feasibility: N/A**
- These are CI/CD tools, not relevant to Orca's use case of managing interactive sessions

---

## Comparison with Current Orca Remote Support

| Feature | Orca agent-remote (current) | `claude --remote` | Agent SDK | `claude -p` |
|---|---|---|---|---|
| Hosting | Self-hosted containers | Anthropic cloud | Local or any server | Local |
| API | AgentAPI (HTTP + SSE) | No public API | Python/TS library | CLI (stdout) |
| Session mgmt | Orca DB + HTTP | Web UI only | Session IDs | Session IDs |
| Real-time | SSE events | Web UI only | Async iterator | stream-json |
| Auth | Bearer token / CF Access | OAuth (Anthropic acct) | API key / cloud creds | API key / cloud creds |
| Repo setup | `/setup` endpoint | Auto-clone | Manual (cwd) | Manual (cwd) |
| Container mgmt | Lazy creation + DELETE | Managed by Anthropic | N/A | N/A |
| Orca effort | Already implemented | No public API | Sidecar needed | Shell out |

## Recommendations

### Short-term: `claude -p --output-format stream-json` as a new backend

**Effort: Medium | Value: High**

Add a `claude-local` backend that uses `claude -p` instead of agent-deck + tmux:
- Shell out to `claude -p --output-format stream-json --allowedTools "..."`
- Parse streaming JSON for real-time message display
- Use `--resume` for multi-turn conversations
- Render in the existing `MessageStream` chat UI
- No agent-deck or tmux dependency required

This would let users run Orca without installing agent-deck, and gives structured message data instead of terminal scraping.

### Medium-term: Agent SDK TypeScript sidecar

**Effort: High | Value: High**

Use the `@anthropic-ai/claude-agent-sdk` npm package via a Tauri sidecar:
- Full programmatic control over sessions
- Hooks for permission handling
- MCP server integration
- Session resume
- Structured, typed messages

This is the most powerful integration path but requires a Node.js sidecar process.

### Long-term: Watch for `claude --remote` API

**Effort: TBD | Value: Very High**

If Anthropic exposes a REST API for cloud sessions, Orca could:
- Create cloud sessions from the UI
- Monitor progress via API polling or SSE
- Display results inline
- No local compute needed for the sessions themselves

This would be the ideal remote execution story but depends on Anthropic shipping a public API.

### Nice-to-have: `claude remote-control` integration

**Effort: Low | Value: Low-Medium**

Add a "Share to mobile" button that:
- Starts `claude remote-control` for the selected session
- Displays the QR code / URL in the Orca UI
- Lets users access the session from their phone

Low effort but niche use case.
