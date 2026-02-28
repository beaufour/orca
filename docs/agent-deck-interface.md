# Agent-Deck Interface Reference

Documents the agent-deck interfaces Orca depends on. Use this to identify breaking changes when upgrading.

**Repository:** https://github.com/asheshgoplani/agent-deck
**Current version: v0.19.11**

## DB Path

```
~/.agent-deck/profiles/default/state.db
```

Resolved via `dirs::home_dir().join(".agent-deck/profiles/default/state.db")`.

## DB Schema

Dumped from v0.11.2 (unchanged through v0.19.11):

```sql
CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE groups (
    path         TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    expanded     INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    default_path TEXT NOT NULL DEFAULT ''
);

CREATE TABLE instances (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    project_path      TEXT NOT NULL,
    group_path        TEXT NOT NULL DEFAULT 'my-sessions',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    command           TEXT NOT NULL DEFAULT '',
    wrapper           TEXT NOT NULL DEFAULT '',
    tool              TEXT NOT NULL DEFAULT 'shell',
    status            TEXT NOT NULL DEFAULT 'error',
    tmux_session      TEXT NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    last_accessed     INTEGER NOT NULL DEFAULT 0,
    parent_session_id TEXT NOT NULL DEFAULT '',
    worktree_path     TEXT NOT NULL DEFAULT '',
    worktree_repo     TEXT NOT NULL DEFAULT '',
    worktree_branch   TEXT NOT NULL DEFAULT '',
    tool_data         TEXT NOT NULL DEFAULT '{}',
    acknowledged      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE instance_heartbeats (
    pid        INTEGER PRIMARY KEY,
    started    INTEGER NOT NULL,
    heartbeat  INTEGER NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0
);
```

### Columns Orca does NOT use

These columns exist in the schema but Orca ignores them:

- `instances.command` — the shell command to run
- `instances.wrapper` — wrapper command template
- `instances.tool` — tool type (claude, gemini, shell, etc.)
- `instances.parent_session_id` — sub-session linking
- `instances.acknowledged` — attention acknowledgement flag
- `metadata` table — not accessed
- `instance_heartbeats.pid`, `.started`, `.heartbeat`, `.is_primary` — not accessed

## DB Queries — Reads

All read queries use `SQLITE_OPEN_READ_ONLY`.

### groups table

| Function       | Query                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| `get_groups()` | `SELECT path, name, expanded, sort_order, default_path FROM groups ORDER BY sort_order` |

### instances table

| Function                    | Query                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `query_sessions_all()`      | `SELECT id, title, project_path, group_path, sort_order, status, tmux_session, created_at, last_accessed, worktree_path, worktree_repo, worktree_branch, tool_data FROM instances ORDER BY group_path, sort_order` |
| `query_sessions_filtered()` | Same as above + `WHERE group_path = ?1`                                                                                                                                                                            |
| `get_attention_counts()`    | `SELECT id, project_path, group_path, status, tool_data FROM instances WHERE status IN ('waiting', 'error')`                                                                                                       |
| `get_attention_sessions()`  | Full 13-column SELECT + `WHERE status IN ('waiting', 'error') ORDER BY group_path, sort_order`                                                                                                                     |
| `get_tmux_session_name()`   | `SELECT tmux_session FROM instances WHERE id = ?1`                                                                                                                                                                 |
| `clear_session_worktree()`  | `SELECT worktree_repo FROM instances WHERE id = ?1`                                                                                                                                                                |
| `query_group_sessions()`    | `SELECT id, tmux_session FROM instances WHERE group_path = ?1`                                                                                                                                                     |

### tool_data JSON parsing

The `tool_data` column contains a JSON object. Orca extracts:

```json
{ "claude_session_id": "<UUID>" }
```

Other keys in the JSON are ignored.

**Note:** `prompt` was previously stored in `tool_data` but has been moved to Orca's own database (`orca.db`). Similarly, `github_issues_enabled` was previously added as a column on agent-deck's `groups` table but now lives in `orca.db`.

## DB Queries — Writes

Orca writes directly to agent-deck's DB for operations that modify agent-deck's own data (worktree metadata, session management, group creation). Orca-specific data (`github_issues_enabled`, `prompt`) is stored in Orca's own database (`~/Library/Application Support/dk.beaufour.orca/orca.db`).

| Function                    | Query                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `create_group()`            | `SELECT COALESCE(MAX(sort_order), -1) FROM groups`                                                       |
|                             | `INSERT INTO groups (path, name, expanded, sort_order, default_path) VALUES (?, ?, 1, ?, ?)`             |
| `update_session_worktree()` | `UPDATE instances SET worktree_path=?, worktree_repo=?, worktree_branch=?, project_path=? WHERE id=?`    |
| `clear_session_worktree()`  | `UPDATE instances SET project_path=?, worktree_path='', worktree_repo='', worktree_branch='' WHERE id=?` |
| `move_session()`            | `SELECT COALESCE(MAX(sort_order), -1) FROM instances WHERE group_path=?`                                 |
|                             | `UPDATE instances SET group_path=?, sort_order=? WHERE id=?`                                             |
| `rename_session()`          | `UPDATE instances SET title=? WHERE id=?`                                                                |
| `remove_session()`          | `DELETE FROM instances WHERE id=?`                                                                       |

## CLI Commands

### `agent-deck add`

Create a new session.

```
agent-deck add <project_path> -g <group> -t <title> -c <tool> -json [-w <branch> [-b]]
```

Flags Orca uses:

- `-g` / `-group` — group path
- `-t` / `-title` — session title
- `-c` / `-cmd` — tool command (defaults to "claude")
- `-json` — JSON output
- `-w` / `-worktree` — create worktree for branch (only for non-bare repos)
- `-b` / `-new-branch` — create new branch (only with `-w`)

**Output parsing** (JSON mode):

1. Normal: finds first `{` in stdout, parses `{"id": "<uuid>", ...}`
2. Conflict: matches `"Session already exists with same title and path: <name> (<id>)"`
3. Failure: non-zero exit code, stderr returned as error

Flags Orca does NOT use: `-mcp`, `-parent`, `-location`, `-wrapper`, `-quiet`, `--quick`/`-Q`, `--resume-session`

### `agent-deck session start`

Start or restart a session.

```
agent-deck session start <session_id>
```

Exit 0 = success, non-zero = failure (stderr).

### `agent-deck remove`

Delete a session.

```
agent-deck remove <session_id>
```

Exit 0 = reported success (but see bug below). Orca always follows up with a direct DB delete as a fallback.

**Known bug**: reports success but doesn't delete from DB when the session's worktree path no longer exists as a git worktree. See `docs/todo.md`.

### `agent-deck launch`

Combined add + start + optional send (v0.18.1). Orca does not currently use this but could replace separate `add` / `session start` calls.

```
agent-deck launch <project_path> [flags] [-m <message>] [--no-wait]
```

Supports all `add` flags plus `-m`/`--message` and `--no-wait`.

### `agent-deck rename`

Rename a session (v0.17.0). Orca does not currently use this — it writes directly to the DB via `rename_session()`.

```
agent-deck rename <session_id> <new_name>
```

### `agent-deck group delete`

Delete a group. Fails if the group still has sessions (unless `--force` is used, which moves sessions to the parent group instead of deleting them).

```
agent-deck group delete <name>
```

Exit 0 = success, non-zero = failure (e.g. group has sessions). Orca removes all sessions first via `agent-deck remove`, then calls `group delete` on the empty group.

### `agent-deck session send --wait`

Send input to a session and block until the agent completes (v0.18.1). Orca does not currently use this.

```
agent-deck session send <session_id> --wait <message>
```

## Status Values

Orca filters on these `instances.status` values:

| Status    | Meaning          |
| --------- | ---------------- |
| `idle`    | Session stopped  |
| `running` | Session active   |
| `waiting` | Needs user input |
| `error`   | Error state      |

Orca specifically filters for `waiting` and `error` in attention queries.

## Conductors (v0.12.0+)

Conductors are meta-agent orchestrators — agent-deck sessions that supervise and coordinate other sessions. They appear as regular sessions in the DB but live in a special "conductor" group pinned to `sort_order = -1`.

Orca doesn't use the conductor system directly, but conductor sessions and their group will appear in DB queries. The pinned `sort_order = -1` means the conductor group sorts before all user groups.

Key details:

- Config lives in `~/.agent-deck/conductor/<name>/meta.json`
- CLI: `agent-deck conductor` subcommand (setup, teardown, list, etc.)
- Heartbeat system checks managed sessions periodically (default: 15 min)
- Optional Telegram bot integration for notifications

## Upgrade Log

### v0.13.0 → v0.19.11 (analyzed 2026-02-23)

**DB schema:** Unchanged. No columns added, removed, or renamed in `instances`, `groups`, `metadata`, or `instance_heartbeats`.

**New CLI commands:**

- `launch` (v0.18.1) — combined add + start + optional send. Not used by Orca.
- `rename` (v0.17.0) — rename a session. Orca still writes directly to DB.
- `session send --wait` (v0.18.1) — send and block until agent completes.
- `codex-notify`, `codex-hooks` (v0.18.0) — Codex integration. Not relevant to Orca.

**New features (no Orca impact):**

- Title-based status detection (v0.14.0) — internal to agent-deck
- Claude Code lifecycle hooks for real-time status detection (v0.16.0) — internal, may improve status freshness in DB
- `--teammate-mode` tmux option for Claude sessions (v0.16.0)
- Slack integration and cross-platform daemon support (v0.16.0)
- Conductor enhancements: Slack auth, symlinked CLAUDE.md, policy split (v0.17.0–v0.19.6)
- Codex/OpenCode tool support (v0.18.0) — new tool types appear as regular sessions in DB
- Notification bar show-all mode with status icons (v0.18.0)
- Batched tmux session options for faster startup (v0.18.1)
- `agent-deck web` mode (v0.19.0) — web UI for agent-deck
- Environment variable support in config paths (v0.19.6)
- `manage_mcp_json` config flag (v0.19.6)
- Skills manager and MCP manager UI improvements (v0.19.3–v0.19.5)

**Status detection changes (v0.14.0–v0.16.0):** Title-based detection (v0.14.0) and lifecycle hooks (v0.16.0) improve how agent-deck determines session status. No impact on Orca — we read status from DB, not our own pattern matching.

**Verdict:** Safe to upgrade with zero Orca code changes. Only `SUPPORTED_VERSION` and this doc needed updating.

### v0.11.2 → v0.13.0 (analyzed 2025-02-11)

**DB schema:** Unchanged. No columns added, removed, or renamed.

**DB behavior (v0.11.3):** `SaveInstances()` now deletes rows not in the provided list, preventing deleted sessions from reappearing on reload. This improves the `remove` bug Orca works around, but keeping the direct-delete fallback is still prudent.

**New CLI flags on `add`:**

- `--quick` / `-Q` — auto-generate adjective-noun session name
- `--resume-session <id>` — resume an existing Claude session (Claude-only)

**New features (no Orca impact):**

- Conductor system (v0.12.0) — meta-agent orchestration
- OpenCode model/agent options (v0.12.1)
- `allow_dangerous_mode` Claude config (v0.11.4) — `--allow-dangerously-skip-permissions`
- `[tmux]` config section for option overrides (v0.12.1)
- Atomic tmux send-keys to prevent Enter key drops (v0.12.2)
- Spinner movement tracking for stuck spinner detection (v0.12.3)
- Quick session creation with Shift+N in TUI (v0.13.0)

**Status detection changes (v0.12.3):** Busy detection window reduced from 25→10 lines. "esc to interrupt" pattern removed. New 3s grace period prevents false waiting-state flashes between tool calls. No impact on Orca (reads status from DB, not own pattern matching).

**Verdict:** Safe to upgrade with zero Orca code changes.

## Breaking Change Checklist

When upgrading agent-deck, verify:

1. **DB location** — still at `~/.agent-deck/profiles/default/state.db`?
2. **Schema columns** — any columns renamed, removed, or reordered in `groups` or `instances`?
3. **Status enum** — still uses `idle`, `running`, `waiting`, `error`?
4. **tool_data format** — still JSON with `claude_session_id` key?
5. **CLI flags** — `-g`, `-t`, `-c`, `-json`, `-w`, `-b` still accepted by `agent-deck add`?
6. **CLI output** — `add -json` still returns `{"id": "..."}` (possibly prefixed)?
7. **Conflict message** — still matches `"Session already exists with same title and path: <name> (<id>)"`?
8. **`session start`** — still accepts `agent-deck session start <id>`?
9. **`remove`** — still accepts `agent-deck remove <id>`?
10. **`group delete`** — still accepts `agent-deck group delete <name>`? Still requires sessions to be removed first (no `--force`)?
11. **Update `SUPPORTED_VERSION`** in `src-tauri/src/agentdeck.rs` and the version at the top of this doc.

## Source Files

| File                         | Role                                                |
| ---------------------------- | --------------------------------------------------- |
| `src-tauri/src/agentdeck.rs` | All CLI and DB interaction                          |
| `src-tauri/src/models.rs`    | Rust structs: `Group`, `Session`, `AttentionCounts` |
| `src/types.ts`               | TypeScript mirrors of Rust structs                  |
