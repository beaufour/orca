# Orca: Migration to OpenCode + Cloudflare Workers

## Overview

Replace the current Claude Code + agent-deck + tmux architecture with OpenCode running
remotely on Cloudflare Workers, accessed via OpenCode's HTTP API (the same interface
that `opencode attach` uses under the hood). Orca becomes a GUI "attach client" — it
drives a remote OpenCode server instead of orchestrating local tmux sessions.

**Dropping**: `agent-deck` (session manager), `tmux` (terminal), Claude Code JSONL
logs, PTY embedding.

**Adding**: OpenCode HTTP API client, SSE event streaming, Cloudflare Worker deployment,
groups managed entirely in Orca's own DB.

---

## New Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Orca Desktop (Tauri)                 │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ Sidebar  │  │ Session Cards │  │ Chat/Output  │  │
│  │ (groups) │  │ (status, sum) │  │ (SSE stream) │  │
│  └──────────┘  └───────────────┘  └──────────────┘  │
├─────────────────────────────────────────────────────┤
│               Tauri Commands (IPC)                   │
├─────────────────────────────────────────────────────┤
│                   Rust Backend                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ opencode.rs │  │ opencode_    │  │ git.rs     │  │
│  │ (HTTP REST) │  │ events.rs    │  │ (worktrees)│  │
│  │             │  │ (SSE client) │  │            │  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
│  ┌─────────────┐  ┌──────────────┐                   │
│  │ orca_db.rs  │  │ github.rs    │                   │
│  │ (groups +   │  │ (unchanged)  │                   │
│  │  settings)  │  │              │                   │
│  └─────────────┘  └──────────────┘                   │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS (REST + SSE)
                         ▼
┌────────────────────────────────────────────────────┐
│           Cloudflare (per-repo Worker)              │
│                                                    │
│  CF Worker  →  Durable Object  →  Container :4096  │
│                                   opencode serve   │
│                                                    │
│  (optional: route AI calls through CF AI Gateway)  │
└────────────────────────────────────────────────────┘
                         │
                         ▼
               AI Provider (Claude, etc.)
```

---

## What Gets Removed

| File | Why removed |
|------|-------------|
| `src-tauri/src/agentdeck.rs` | Entire agent-deck integration gone |
| `src-tauri/src/claude_logs.rs` | JSONL parsing replaced by OpenCode SSE events |
| `src-tauri/src/tmux.rs` | No more tmux — OpenCode manages its own execution |
| `src-tauri/src/pty.rs` | PTY embedding replaced by HTTP event streaming |

---

## What Gets Created

| File | Purpose |
|------|---------|
| `src-tauri/src/opencode.rs` | OpenCode HTTP REST client (session CRUD, prompt sending) |
| `src-tauri/src/opencode_events.rs` | SSE event subscription, status tracking per session |
| `cloudflare/worker.ts` | CF Worker + Durable Object proxy to OpenCode container |
| `cloudflare/wrangler.toml` | Cloudflare deployment config |

---

## What Gets Modified

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Re-register all commands; remove old, add new |
| `src-tauri/src/orca_db.rs` | Add `groups` and `group_settings` tables (was agent-deck's job) |
| `src-tauri/src/models.rs` | Replace agent-deck types with OpenCode session/message types |
| `src-tauri/Cargo.toml` | Add `reqwest`, `tokio-stream`, `eventsource-stream`; remove tmux/pty deps |
| `src/types.ts` | Update TypeScript interfaces for OpenCode schema |
| `src/App.tsx` | Update queries and commands to new API |
| `src/components/TerminalView.tsx` | Replace xterm.js PTY with SSE message stream display |
| `src/components/SessionCard.tsx` | Update status/summary derivation for OpenCode events |
| `src/components/Sidebar.tsx` | Groups now from Orca DB, with full CRUD |
| `CLAUDE.md` | Remove agent-deck / tmux references |

---

## OpenCode HTTP API (port 4096)

OpenCode's server is a Hono-based HTTP API with SSE streaming. All communication
happens over HTTPS to the Cloudflare Worker URL.

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

| Event | Meaning for Orca |
|-------|-----------------|
| `session.created` | New session available |
| `session.updated` | Title/metadata changed |
| `message.updated` | Message content changed → update summary |
| `session.idle` | Agent finished → status = idle |
| `session.error` | Error occurred → status = error |
| `tool.execute.before` | Tool running → status = running |
| `question.created` | Agent needs input → status = needs_input |
| `permission.created` | Agent needs permission → status = needs_input |

### Send a prompt (the "attach equivalent")

```http
POST /session/:id/message
Content-Type: application/json

{
  "parts": [
    { "type": "text", "text": "implement the feature" }
  ]
}
```

Response is empty (202). Subscribe to `/session/:id/event` SSE stream to receive
the response as it streams in.

### Authentication

Set `OPENCODE_SERVER_PASSWORD` env var in the container. Orca sends
`Authorization: Basic <base64(opencode:<password>)>` on every request.
Password stored in Orca's settings table, never hard-coded.

---

## Cloudflare Worker Setup

Based on [cloudflare/sandbox-sdk opencode example](https://github.com/cloudflare/sandbox-sdk/tree/main/examples/opencode).

### Architecture

```
HTTPS request from Orca
  → Cloudflare Worker (edge)
    → Durable Object (persists container across requests)
      → Container running `opencode serve` on :4096
```

The Durable Object acts as a persistent proxy. The container stays alive as long as
the DO instance exists. Each "project" (group in Orca) maps to one Durable Object
instance (keyed by repo path or project name).

### `cloudflare/worker.ts`

```typescript
import { DurableObject } from "cloudflare:workers"

export class OpenCodeSession extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    // proxyToOpencode() → forwards to container:4096
    // Starts container with `opencode serve` if not running
    return proxyToOpencode(request, this.ctx)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route: /session/<project-id>/* → specific DO instance
    const projectId = extractProjectId(request)
    const id = env.OPENCODE_SESSION.idFromName(projectId)
    const stub = env.OPENCODE_SESSION.get(id)
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

The container runs:
```bash
opencode serve --port 4096
```

Uses the official OpenCode Docker image or a custom one with required tools
(git, node, your language toolchains).

---

## Data Model Changes

### OpenCode session (replaces agent-deck `instances`)

```typescript
interface Session {
  id: string                // OpenCode session UUID
  title: string
  parentId?: string
  created: number           // Unix ms
  updated: number           // Unix ms
}

// Orca augments with:
interface OrcaSession extends Session {
  groupPath: string         // stored in orca_db
  worktreeBranch?: string   // stored in orca_db
  serverUrl: string         // which CF Worker URL
  status: AttentionStatus   // derived from SSE events
  summary?: string          // from latest message content
}
```

### Orca DB schema additions

```sql
-- Groups (was in agent-deck, now owned by Orca)
CREATE TABLE groups (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  server_url  TEXT NOT NULL,   -- Cloudflare Worker URL for this group
  sort_order  INTEGER DEFAULT 0
);

-- Per-session metadata Orca tracks (worktree, group membership)
CREATE TABLE session_meta (
  session_id     TEXT PRIMARY KEY,
  group_path     TEXT NOT NULL,
  server_url     TEXT NOT NULL,
  worktree_path  TEXT,
  worktree_branch TEXT,
  worktree_repo  TEXT,
  prompt         TEXT,
  dismissed      INTEGER DEFAULT 0
);

-- Settings (unchanged)
CREATE TABLE group_settings (
  group_path         TEXT PRIMARY KEY,
  github_issues_enabled INTEGER DEFAULT 1,
  merge_workflow     TEXT DEFAULT 'merge',
  worktree_command   TEXT,
  component_depth    INTEGER DEFAULT 2
);
```

### AttentionStatus derivation (without JSONL)

```rust
// Derived purely from SSE events + REST API
enum AttentionStatus {
    NeedsInput,   // question.created or permission.created event
    Error,        // session.error event, or last message is_error
    Running,      // tool.execute.before with no subsequent session.idle
    Idle,         // session.idle event received
    Stale,        // Idle + updated timestamp > 1 hour ago
    Unknown,      // No events received yet
}
```

---

## Rust Backend: New Tauri Commands

### `opencode.rs` — session management

```rust
// Session CRUD via OpenCode REST API
#[tauri::command] get_sessions(group_path, server_url) -> Vec<OrcaSession>
#[tauri::command] create_session(group_path, server_url, title, prompt?) -> Session
#[tauri::command] delete_session(session_id, server_url) -> ()
#[tauri::command] rename_session(session_id, server_url, title) -> ()
#[tauri::command] send_message(session_id, server_url, text) -> ()
#[tauri::command] abort_session(session_id, server_url) -> ()
#[tauri::command] get_messages(session_id, server_url) -> Vec<Message>
#[tauri::command] respond_to_permission(session_id, server_url, perm_id, allow) -> ()
```

### `opencode_events.rs` — SSE streaming

```rust
// Subscribe to /event (global) SSE stream from a server URL
// Emits Tauri events: "oc-event" with payload { server_url, event_type, data }
// Maintains one SSE connection per unique server_url
// Reconnects with exponential backoff on disconnect
#[tauri::command] subscribe_events(server_url: String, on_event: Channel) -> ()
#[tauri::command] unsubscribe_events(server_url: String) -> ()
```

### Group management (moved from agent-deck to orca_db)

```rust
#[tauri::command] get_groups() -> Vec<Group>
#[tauri::command] create_group(name, server_url, path?) -> Group
#[tauri::command] update_group(path, name?, server_url?, sort_order?) -> ()
#[tauri::command] delete_group(path) -> ()
```

### Removed commands (no replacement needed)

```
check_agent_deck_version   → removed
list_tmux_sessions         → removed
attach_pty                 → removed
write_pty                  → removed
resize_pty                 → removed
close_pty                  → removed
paste_to_tmux_pane         → removed
scroll_tmux_pane           → removed
is_waiting_for_input       → removed
get_session_summary        → removed (status from SSE, summary from REST)
```

---

## Frontend: TerminalView → MessageStream

The current `TerminalView` embeds xterm.js and attaches to a tmux PTY. Since OpenCode
manages its own execution environment, there's no PTY to attach to.

### Option A: SSE message stream display (recommended)

Replace `TerminalView` with a chat-style view that:
1. Loads existing messages via `GET /session/:id/message`
2. Subscribes to `message.updated` SSE events for live streaming
3. Renders message parts: text, tool calls, tool results, thinking blocks
4. Input bar at bottom → `POST /session/:id/message`
5. Shows permission/question prompts inline with approve/deny buttons

This is a clean fit for OpenCode's message-based architecture and works well
for remote sessions.

### Option B: Embed OpenCode web UI in a WebView

OpenCode's `opencode web` serves a full web UI on port 4096. The Cloudflare Worker
already proxies this. Orca could embed it in a Tauri WebView:

```rust
// Point a Tauri WebView at the CF Worker URL for a session
tauri::WebviewWindowBuilder::new("session-{id}", url).build()
```

Pros: zero frontend work, full OpenCode UI. Cons: loses Orca's custom UI, harder
to integrate with worktree actions and status badges.

**Recommendation**: Option A for now, with Option B as a fallback escape hatch if
message rendering becomes complex.

---

## Phase-by-Phase Implementation

### Phase 1 — Core infrastructure (no UI changes yet)

1. Add `reqwest`, `tokio-stream`, `eventsource-stream` to `Cargo.toml`
2. Create `opencode.rs` with HTTP client helpers (auth, base URL, error types)
3. Create `opencode_events.rs` with SSE subscription manager
4. Extend `orca_db.rs`: add `groups`, `session_meta` tables + migrations
5. Update `models.rs` with OpenCode types (`Session`, `Message`, `MessagePart`)
6. Wire up new Tauri commands in `lib.rs` alongside old ones (parallel period)
7. Create `cloudflare/` directory with `worker.ts` and `wrangler.toml`

### Phase 2 — Session management

1. Implement `get_sessions()` via `GET /session` on the configured server URL
2. Implement `create_session()` via `POST /session` + optional `POST /session/:id/message`
3. Implement `delete_session()`, `rename_session()`, `abort_session()`
4. Implement `get_groups()` / CRUD from Orca DB
5. Update frontend `App.tsx` to use new commands; old queries behind feature flag

### Phase 3 — Status and summaries via SSE

1. Implement `subscribe_events()` SSE client in `opencode_events.rs`
2. Map OpenCode event types → `AttentionStatus`
3. Derive session summary from latest `message.updated` content
4. Emit `oc-event` Tauri events to frontend
5. Update `SessionCard.tsx` to use new status + summary

### Phase 4 — Messaging / input

1. Implement `send_message()` via `POST /session/:id/message`
2. Implement `respond_to_permission()` for approve/deny prompts
3. Replace `TerminalView.tsx` with `MessageStream.tsx` (Option A above):
   - Load history via `get_messages()` command
   - Subscribe to SSE stream for live updates
   - Render parts: text, tool calls, tool results
   - Inline permission request cards

### Phase 5 — Remove old code

1. Delete `agentdeck.rs`, `claude_logs.rs`, `tmux.rs`, `pty.rs`
2. Remove `rusqlite` dep on agent-deck DB path (keep for orca_db)
3. Remove `portable-pty` and tmux-related dependencies
4. Remove old Tauri commands from `lib.rs`
5. Remove old TypeScript types referencing agent-deck fields
6. Remove prerequisite checks for `agent-deck` and `tmux`

### Phase 6 — Cloudflare deployment

1. Test locally: run `opencode serve` locally, point Orca at `http://localhost:4096`
2. Deploy CF Worker: `wrangler deploy`
3. Add group UI for entering CF Worker URL when creating a group
4. Test full flow: create group → Worker URL → session → prompt → SSE stream

### Phase 7 — Polish

1. Handle SSE reconnection (exponential backoff, connection status indicator)
2. Handle offline/unreachable server gracefully in UI
3. Git worktree actions still work (run locally against cloned repo)
4. GitHub integration unchanged
5. Update `CLAUDE.md` and `docs/design.md`
6. Add settings UI for server auth password (per-group)

---

## Dependencies Changes

### Cargo.toml — add

```toml
reqwest = { version = "0.12", features = ["json", "stream"] }
tokio-stream = "0.1"
eventsource-stream = "0.2"   # or reqwest-eventsource
futures = "0.3"
```

### Cargo.toml — remove

```toml
# Remove (no more tmux PTY embedding):
portable-pty = "..."
# rusqlite stays (used by orca_db), but agent-deck DB path logic removed
```

### package.json — add

```json
"@opencode-ai/sdk": "^0.x"   // for type definitions only (optional)
```

---

## Migration Path for Existing Users

Since agent-deck is being dropped entirely, existing sessions stored in agent-deck's
DB won't automatically transfer. Options:

1. **Clean break**: users start fresh with OpenCode sessions (simplest)
2. **One-time import**: read agent-deck DB on first run, create corresponding entries
   in `session_meta` Orca DB with empty `server_url` (sessions stay visible but
   are "legacy / disconnected")

Recommendation: clean break, given the fundamental architecture change.

---

## Open Questions

1. **Worktree path for remote sessions** — sessions run on Cloudflare, but git
   worktrees are local. How does OpenCode on Cloudflare access the code?
   Options:
   - Clone the repo into the container on session creation
   - Mount a volume / use R2 for code storage
   - Sessions for remote work vs local dev are different use cases

2. **Multiple CF Workers vs one** — one Worker per group (repo), or one global
   Worker with per-session routing? The Durable Object keyed by project ID
   handles this cleanly: one Worker, many DO instances.

3. **Persistent container cost** — Cloudflare containers are billed by runtime.
   Need to configure idle timeout or manual shutdown. Orca could add a
   "pause container" action to the group settings.

4. **File access for git operations** — worktree merge/rebase currently runs
   locally. If the code lives remotely, these need to either run inside the
   container (via `POST /session/:id/shell`) or remain local with the repo
   cloned in both places.

---

## Summary of Key Benefits

- **No agent-deck dependency** — simpler install, no version pinning
- **No tmux dependency** — cleaner, works on Windows/macOS without tmux
- **Remote execution** — sessions run on Cloudflare, not consuming local CPU
- **Any AI provider** — OpenCode is provider-agnostic, not locked to Claude
- **Official HTTP API** — well-defined REST + SSE interface instead of parsing
  JSONL files and scraping tmux panes
- **OpenCode web UI as fallback** — the same Worker URL opens in a browser too
