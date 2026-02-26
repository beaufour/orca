# Orca: Pluggable Backend Architecture (OpenCode + Cloudflare Workers)

## Overview

Introduce a **pluggable backend adapter** so Orca can drive sessions via different
agents — keeping the current Claude Code + agent-deck path working while adding an
OpenCode-on-Cloudflare path. Each group in Orca independently picks a backend.

This avoids a hard cutover, lets both backends run side-by-side, and derisks the
migration: if OpenCode on Cloudflare turns out to miss important Claude Code features,
existing groups are unaffected.

---

## Claude Code vs OpenCode (with Claude models)

OpenCode is provider-agnostic, supports Claude, and handles most everyday coding
tasks well. But there are meaningful gaps compared to Claude Code itself:

| Capability | Claude Code | OpenCode w/ Claude |
|---|---|---|
| System prompt | Anthropic-tuned, deeply optimised | OpenCode's own |
| Plan mode / ExitPlanMode | Native, first-class tool | Not present |
| Hooks (`~/.claude/hooks/`) | Full pre/post-tool hook system | Different mechanism |
| Extended thinking | Exposed | Not guaranteed |
| Sub-agents / Task tool | Native | Not present |
| Tool implementations | Anthropic's (bash, edit, read) | OpenCode's own |
| Session format | JSONL in `~/.claude/` | OpenCode JSON |
| Attention signals | `AskUserQuestion`, `ExitPlanMode` | `question.created` events |
| MCP support | Yes | Yes |
| Provider lock-in | Anthropic only | 75+ providers |

**Verdict**: For day-to-day coding the gap is small, but plan mode, hooks, and
sub-agents are Claude Code-specific capabilities that matter. Supporting both backends
lets users choose per project.

---

## New Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Orca Desktop (Tauri)                         │
│  ┌──────────┐   ┌───────────────┐   ┌──────────────────────────┐ │
│  │ Sidebar  │   │ Session Cards │   │ Session Detail           │ │
│  │ (groups) │   │ (status, sum) │   │ TerminalView (CC)        │ │
│  │          │   │               │   │   OR                     │ │
│  │ backend  │   │ status badge  │   │ MessageStream (OC)       │ │
│  │ per group│   │ from adapter  │   │                          │ │
│  └──────────┘   └───────────────┘   └──────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│                       Tauri Commands (IPC)                        │
├──────────────────────────────────────────────────────────────────┤
│                         Rust Backend                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  backend/mod.rs (trait)                    │  │
│  │  AgentBackend: list_sessions · create · delete · send ·    │  │
│  │                subscribe_events · get_summary              │  │
│  └────────────────────────────────────────────────────────────┘  │
│         ▲                                    ▲                    │
│  ┌──────┴──────┐                    ┌────────┴────────┐          │
│  │ backend/    │                    │ backend/        │          │
│  │ claude_     │                    │ opencode.rs     │          │
│  │ code.rs     │                    │ (HTTP REST+SSE) │          │
│  │ (agentdeck  │                    │                 │          │
│  │ +tmux+JSONL)│                    │                 │          │
│  └─────────────┘                    └─────────────────┘          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ orca_db.rs  │  │ git.rs       │  │ github.rs      │          │
│  │ (owns groups│  │ (unchanged)  │  │ (unchanged)    │          │
│  │  + settings)│  │              │  │                │          │
│  └─────────────┘  └──────────────┘  └────────────────┘          │
└──────────────────────────────────────────────────────────────────┘
         │ (claude-code groups)         │ (opencode groups)
         ▼                              ▼
   agent-deck + tmux            HTTPS (REST + SSE)
   Claude JSONL logs                    │
   (local, unchanged)                   ▼
                             ┌──────────────────────────┐
                             │  Cloudflare              │
                             │  Worker → DO → Container │
                             │  opencode serve :4096    │
                             └──────────────────────────┘
                                         │
                                         ▼
                               AI Provider (Claude, etc.)
```

---

## Backend Adapter Trait

```rust
// src-tauri/src/backend/mod.rs

#[async_trait]
pub trait AgentBackend: Send + Sync {
    async fn list_sessions(&self, group_path: &str) -> Result<Vec<Session>>;
    async fn create_session(&self, params: CreateSessionParams) -> Result<Session>;
    async fn delete_session(&self, session_id: &str) -> Result<()>;
    async fn rename_session(&self, session_id: &str, title: &str) -> Result<()>;
    async fn abort_session(&self, session_id: &str) -> Result<()>;
    async fn send_message(&self, session_id: &str, text: &str) -> Result<()>;
    async fn get_messages(&self, session_id: &str) -> Result<Vec<Message>>;
    async fn get_summary(&self, session_id: &str) -> Result<Option<String>>;
    async fn subscribe_events(
        &self,
        group_path: &str,
        sender: mpsc::Sender<BackendEvent>,
    ) -> Result<()>;
    async fn respond_to_prompt(
        &self,
        session_id: &str,
        prompt_id: &str,
        response: PromptResponse,
    ) -> Result<()>;
}

pub enum BackendEvent {
    StatusChanged { session_id: String, status: AttentionStatus },
    SummaryUpdated { session_id: String, summary: String },
    SessionCreated { session: Session },
    SessionRemoved { session_id: String },
}

// Dispatch based on group config:
pub fn get_backend(group: &Group) -> Arc<dyn AgentBackend> {
    match group.backend.as_str() {
        "opencode" => Arc::new(OpenCodeBackend::new(&group.server_url, &group.password)),
        _          => Arc::new(ClaudeCodeBackend::new()),  // default
    }
}
```

---

## Backend Implementations

### `backend/claude_code.rs` (refactored from current code)

The existing `agentdeck.rs`, `claude_logs.rs`, `tmux.rs`, and `pty.rs` are
**not deleted** — they are wrapped into `ClaudeCodeBackend` implementing the trait.

- `list_sessions` → query agent-deck SQLite DB (existing logic)
- `create_session` → `agent-deck add` CLI (existing logic)
- `subscribe_events` → poll agent-deck DB + parse JSONL logs (existing logic)
- `send_message` → tmux send-keys (existing logic)
- Terminal UI → `TerminalView.tsx` with xterm.js PTY (unchanged)

The refactor is mostly mechanical: move the free functions into an impl block,
implement the trait, keep all the existing behaviour.

### `backend/opencode.rs` (new)

- `list_sessions` → `GET /session` on CF Worker URL
- `create_session` → `POST /session` + optional `POST /session/:id/message`
- `subscribe_events` → SSE stream on `GET /event`
- `send_message` → `POST /session/:id/message`
- Terminal UI → `MessageStream.tsx` with SSE rendering (new)

---

## Group Schema Change

Add a single `backend` column (and `server_url` for OpenCode groups) to the groups
table. Groups without it default to `"claude-code"`.

```sql
-- Orca DB: groups table
CREATE TABLE groups (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  backend     TEXT NOT NULL DEFAULT 'claude-code',  -- 'claude-code' | 'opencode'
  server_url  TEXT,          -- CF Worker URL (opencode only)
  password    TEXT,          -- server auth (opencode only)
  sort_order  INTEGER DEFAULT 0
);
```

Agent-deck's `groups` table is still read for `claude-code` groups (it remains the
source of truth for their sort order, expansion state, etc). Orca's table stores the
extra fields agent-deck doesn't know about.

---

## Per-Group Backend in the UI

When creating or editing a group, a picker appears:

```
Backend:  ● Claude Code (local, agent-deck)
          ○ OpenCode (remote, Cloudflare)
               Server URL: [https://orca.example.workers.dev]
               Password:   [••••••••••••••]
```

The session detail panel switches automatically:
- Claude Code groups → `TerminalView` (xterm.js + PTY, existing)
- OpenCode groups → `MessageStream` (SSE chat, new)

---

## OpenCode HTTP API (port 4096)

OpenCode's server is Hono-based with REST + SSE. Orca communicates with it over
HTTPS to the Cloudflare Worker URL.

### Session endpoints

```
POST   /session                        Create session
GET    /session                        List sessions
GET    /session/:id                    Get session
DELETE /session/:id                    Delete session
PATCH  /session/:id                    Rename / update session
POST   /session/:id/abort              Abort running session
POST   /session/:id/summarize          Request summary generation
```

### Messaging endpoints

```
POST   /session/:id/message            Send message (triggers agent run)
GET    /session/:id/message            List messages
POST   /session/:id/prompt             Synchronous prompt (blocks until done)
POST   /session/:id/prompt_async       Async prompt (returns immediately)
POST   /session/:id/command            Send slash command
POST   /session/:id/permissions/:pid   Respond to permission request
```

### Event streaming (SSE)

```
GET    /event                          Global SSE stream (all sessions)
GET    /session/:id/event              Per-session SSE stream
```

SSE events relevant to Orca:

| Event | Maps to AttentionStatus |
|-------|------------------------|
| `session.idle` | Idle |
| `session.error` | Error |
| `tool.execute.before` | Running |
| `question.created` | NeedsInput |
| `permission.created` | NeedsInput |
| `message.updated` | → update summary |
| `session.created` / `session.updated` | → refresh session list |

### Authentication

Set `OPENCODE_SERVER_PASSWORD` in the container. Orca sends
`Authorization: Basic <base64(opencode:<password>)>` on every request.
Password stored in `groups.password` in Orca's SQLite, never in config files.

---

## Cloudflare Worker Setup

Based on [cloudflare/sandbox-sdk opencode example](https://github.com/cloudflare/sandbox-sdk/tree/main/examples/opencode).

### Request flow

```
Orca HTTPS request
  → Cloudflare Worker (edge)
    → Durable Object (keyed by project name, persists container)
      → Container running `opencode serve` on :4096
```

One global Worker, many DO instances — one per Orca group. The DO key is the
group's `path` value, making routing deterministic.

### `cloudflare/worker.ts`

```typescript
import { DurableObject } from "cloudflare:workers"

export class OpenCodeSession extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    // Proxies to container:4096, starting it if needed
    return proxyToOpencode(request, this.ctx)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // /project/<id>/* → DO instance keyed by project id
    const projectId = new URL(request.url).pathname.split("/")[2]
    const stub = env.OPENCODE_SESSION.get(
      env.OPENCODE_SESSION.idFromName(projectId)
    )
    return stub.fetch(request)
  }
}
```

### `cloudflare/wrangler.toml`

```toml
name = "orca-opencode"
main = "worker.ts"
compatibility_date = "2025-01-01"

[[durable_objects.bindings]]
name = "OPENCODE_SESSION"
class_name = "OpenCodeSession"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["OpenCodeSession"]

[vars]
OPENCODE_SERVER_PASSWORD = ""  # set in .dev.vars / CF dashboard
```

### Container image

The container runs `opencode serve --port 4096`. Use the official OpenCode image or
a custom one with language toolchains (node, cargo, python, etc.) baked in.

---

## Data Model

### Unified `Session` type

```typescript
interface Session {
  id: string
  title: string
  groupPath: string
  backend: "claude-code" | "opencode"
  status: AttentionStatus
  summary?: string
  lastTool?: string
  // Claude Code backend only:
  tmuxSession?: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeRepo?: string
  // OpenCode backend only:
  serverUrl?: string
  parentId?: string
}
```

The frontend treats sessions uniformly; backend-specific fields are used only where
the UI branches (TerminalView vs MessageStream).

### Orca DB additions

```sql
-- New columns on group_settings (or a new groups table):
ALTER TABLE group_settings ADD COLUMN backend     TEXT DEFAULT 'claude-code';
ALTER TABLE group_settings ADD COLUMN server_url  TEXT;
ALTER TABLE group_settings ADD COLUMN password    TEXT;

-- OpenCode session metadata (maps OC session IDs into Orca groups)
CREATE TABLE opencode_session_meta (
  session_id      TEXT PRIMARY KEY,
  group_path      TEXT NOT NULL,
  server_url      TEXT NOT NULL,
  worktree_path   TEXT,
  worktree_branch TEXT,
  worktree_repo   TEXT,
  dismissed       INTEGER DEFAULT 0
);
```

### AttentionStatus mapping

Both backends produce the same `AttentionStatus` enum; derivation differs:

| Status | Claude Code source | OpenCode source |
|--------|-------------------|-----------------|
| NeedsInput | `AskUserQuestion` / `ExitPlanMode` tool, or tmux pane check | `question.created` / `permission.created` SSE event |
| Error | agent-deck `status=error` | `session.error` SSE event |
| Running | agent-deck `status=running` | `tool.execute.before` SSE event |
| Idle | agent-deck `status=idle` | `session.idle` SSE event |
| Stale | Idle + last timestamp > 1h | Idle + `updated` > 1h |

---

## Frontend Session Detail: Two Views

`SessionDetailView` renders one of two panels based on `session.backend`:

### `TerminalView` (Claude Code — unchanged)
xterm.js + PTY attached to tmux session. Existing implementation kept as-is.

### `MessageStream` (OpenCode — new)
```
┌────────────────────────────────────────────────┐
│ [tool: read_file src/main.rs]           running │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ assistant                                   │ │
│ │ I'll start by reading the main entry point. │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ tool: bash                                  │ │
│ │ $ cargo build                               │ │
│ │ Compiling orca v0.1.0 ...                   │ │
│ └─────────────────────────────────────────────┘ │
│ ┌── Permission required ─────────────────────┐  │
│ │ Run: rm -rf target/   [Allow] [Deny]        │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ Type a message...                  Send │    │
│  └─────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

1. On open: load history via `get_messages(session_id, server_url)`
2. Subscribe to `session/:id/event` SSE for live streaming
3. Render `MessagePart` types: text, tool_use, tool_result, thinking
4. Permission/question cards with inline approve/deny
5. Input bar → `send_message(session_id, server_url, text)`

---

## Files Changed

### New files

| File | Purpose |
|------|---------|
| `src-tauri/src/backend/mod.rs` | `AgentBackend` trait + dispatch |
| `src-tauri/src/backend/claude_code.rs` | Refactored agentdeck+tmux+JSONL adapter |
| `src-tauri/src/backend/opencode.rs` | New HTTP REST + SSE adapter |
| `src/components/MessageStream.tsx` | OpenCode session detail view |
| `cloudflare/worker.ts` | CF Worker + Durable Object proxy |
| `cloudflare/wrangler.toml` | Cloudflare deployment config |

### Modified files

| File | What changes |
|------|-------------|
| `src-tauri/src/agentdeck.rs` | Internals moved into `ClaudeCodeBackend`; public API becomes the trait |
| `src-tauri/src/lib.rs` | Commands now dispatch via `get_backend()`; add group CRUD commands |
| `src-tauri/src/orca_db.rs` | Add `backend`, `server_url`, `password` to group settings; add `opencode_session_meta` table |
| `src-tauri/src/models.rs` | Unified `Session` type; add OpenCode message types |
| `src-tauri/Cargo.toml` | Add `reqwest`, `tokio-stream`, `eventsource-stream`, `async-trait` |
| `src/types.ts` | Unified session type; `backend` discriminant field |
| `src/App.tsx` | Pass `backend` context to queries; branch on backend where needed |
| `src/components/SessionCard.tsx` | Unchanged; reads unified `AttentionStatus` |
| `src/components/SessionDetailView.tsx` | New wrapper: routes to TerminalView or MessageStream |
| `src/components/Sidebar.tsx` | Group creation UI gains backend picker |

### Files NOT changed

`tmux.rs`, `pty.rs`, `claude_logs.rs` — these become internal to `ClaudeCodeBackend`.
They are not deleted or moved until a deliberate cleanup phase (if ever).

---

## Phase-by-Phase Implementation

### Phase 0 — Extract the adapter trait (no behaviour change)

1. Create `src-tauri/src/backend/mod.rs` with `AgentBackend` trait
2. Move `agentdeck.rs` logic into `ClaudeCodeBackend` implementing the trait
3. Tauri commands call `get_backend(group)` and invoke trait methods
4. All existing tests still pass; no UI changes

This phase produces a refactor-only diff — safe to merge independently.

### Phase 1 — OpenCode adapter infrastructure

1. Add `reqwest`, `eventsource-stream`, `async-trait` to `Cargo.toml`
2. Create `backend/opencode.rs` skeleton: HTTP client, auth headers, error types
3. Implement SSE subscription manager (one connection per `server_url`)
4. Add `backend`, `server_url`, `password` columns to `group_settings` in Orca DB
5. Add `opencode_session_meta` table
6. Create `cloudflare/` directory with `worker.ts` and `wrangler.toml`

### Phase 2 — OpenCode session management

1. Implement `list_sessions`, `create_session`, `delete_session`, `rename_session`
2. Implement `get_messages`, `send_message`, `respond_to_prompt`
3. Wire up `subscribe_events` → emit `oc-event` Tauri events per session
4. Add group CRUD commands to `lib.rs` (groups now have backend field)

### Phase 3 — OpenCode UI

1. Add backend picker to group creation/edit modal in Sidebar
2. Create `MessageStream.tsx` for OpenCode session detail
3. Add `SessionDetailView.tsx` to route TerminalView ↔ MessageStream by backend
4. Update `App.tsx` to pass `serverUrl` alongside `sessionId` for OpenCode groups

### Phase 4 — Cloudflare deployment

1. Test locally: `opencode serve --port 4096`, point a group at `http://localhost:4096`
2. Deploy CF Worker: `wrangler deploy`
3. Document container setup (what tools to bake in, idle timeout config)
4. End-to-end test: create OpenCode group → session → prompt → SSE stream

### Phase 5 — Polish

1. SSE reconnection with exponential backoff; connection status indicator per group
2. Graceful offline handling (cached last status shown, retry button)
3. Add per-group "pause container" action (sends signal to CF Worker to hibernate DO)
4. Auth password stored encrypted in Orca DB (using OS keychain via `keyring` crate)
5. Update `CLAUDE.md`, `docs/design.md`

---

## Dependencies Changes

### Cargo.toml additions

```toml
reqwest          = { version = "0.12", features = ["json", "stream"] }
tokio-stream     = "0.1"
eventsource-stream = "0.2"
async-trait      = "0.1"
futures          = "0.3"
```

No removals — `portable-pty`, `rusqlite`, tmux code all stay (used by `ClaudeCodeBackend`).

### package.json additions

```json
"@opencode-ai/sdk": "^0.x"   // for TypeScript type definitions (optional)
```

---

## Migration Path

Existing users keep all their current sessions and groups working on the
`claude-code` backend (default). No data migration needed.

To try OpenCode: create a new group, select "OpenCode" backend, enter CF Worker URL.
Both types of group can coexist in the same Orca instance indefinitely.

There is no forced cutover.

---

## Open Questions

1. **Code access for remote sessions** — the OpenCode container on Cloudflare needs
   the repo to work on. Options:
   - Clone the repo into the container on session creation (simplest, costs storage)
   - Push a branch to GitHub; container clones from there
   - Keep a local clone synced and use a tunnel (ngrok / Cloudflare Tunnel) — hybrid
   - Accept that OpenCode on CF is for new greenfield work, not existing local repos

2. **Persistent container cost** — containers billed by runtime. Orca should expose
   a "hibernate" button per OpenCode group, and containers should auto-sleep after
   N minutes of `session.idle` events with no new messages.

3. **Git operations for OpenCode sessions** — worktree merge/rebase/push currently
   runs locally. For remote sessions this either needs to run inside the container
   (via `POST /session/:id/message` with a git instruction) or Orca keeps a local
   mirror clone and runs git locally as it does today.

4. **`ClaudeCodeBackend` long-term** — once OpenCode matures (plan mode support,
   hooks, sub-agents), the Claude Code backend could be deprecated. The adapter
   pattern makes this a clean swap rather than a rewrite.

---

## Summary

| | Claude Code backend | OpenCode backend |
|---|---|---|
| Execution | Local (tmux) | Remote (Cloudflare) |
| Session manager | agent-deck | OpenCode HTTP API |
| Status tracking | JSONL logs + tmux scrape | SSE events |
| Terminal UI | xterm.js PTY | Message stream |
| Plan mode | ✓ | ✗ |
| Hooks | ✓ | ✗ |
| Sub-agents | ✓ | ✗ |
| Any AI provider | ✗ (Anthropic only) | ✓ |
| CPU on local machine | Used | Not used |
| Install requirements | agent-deck, tmux, claude | CF Worker URL + password |
