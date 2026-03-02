# Orca Integration Plan: Claude Code Remote Backend

This document describes what [Orca](https://github.com/beaufour/orca) needs to support the Claude Code remote backend served by agent-remote.

## Overview

Agent-remote now exposes two backends:

- **OpenCode** at `/opencode/<id>/*` — multi-session REST API
- **Claude Code** at `/claude/<id>/*` — single-session API via [AgentAPI](https://github.com/coder/agentapi)

Orca currently supports "opencode-remote" as a backend type. A new "claude-remote" backend type is needed for the AgentAPI protocol.

## Authentication

Agent-remote uses two-level authentication:

1. **Cloudflare Access (primary)** — protects all routes at the edge. After login, requests carry a JWT via the `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie. The worker verifies this against the CF Access JWKS endpoint.
2. **Bearer token (fallback for dev)** — `Authorization: Bearer <AUTH_TOKEN>` checked against the `AUTH_TOKEN` env var. Only used when CF Access JWT is absent.

Orca must send the token as `Authorization: Bearer <token>`. If the server is behind Cloudflare Access and the token isn't a valid CF Access JWT, the request will be intercepted and an HTML login page returned instead of JSON.

## AgentAPI Protocol

AgentAPI wraps the Claude Code CLI and exposes these endpoints:

### `GET /messages`

Returns all conversation messages wrapped in an object.

```json
{
  "messages": [
    {
      "id": 1,
      "role": "user",
      "content": "Hello",
      "time": "2025-01-01T00:00:00Z"
    },
    {
      "id": 2,
      "role": "agent",
      "content": "Hi! How can I help?",
      "time": "2025-01-01T00:00:01Z"
    }
  ]
}
```

Note: role is `"agent"` (not `"assistant"`), timestamp field is `"time"`, and `id` is an integer representing message order.

### `POST /message`

Send a message to the agent. Body:

```json
{
  "content": "Fix the bug in auth.ts",
  "type": "user"
}
```

The `type` field can be `"user"` (logged in conversation history) or `"raw"` (written directly to terminal).

### `GET /status`

Returns the agent's current status:

```json
{
  "status": "stable"
}
```

Possible values: `"stable"` (waiting for input), `"running"` (processing).

### `GET /events`

SSE stream of real-time updates. Event types:

- `message_update` — new or updated message
- `status_change` — agent status change
- `screen_update` — terminal screen content changed

## Key Differences from OpenCode Remote

| Aspect       | OpenCode Remote                                       | Claude Remote                                                          |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Sessions     | Multi-session (`/sessions`, `/sessions/:id/messages`) | Single session (no session concept)                                    |
| Base URL     | `/opencode/<id>`                                      | `/claude/<id>`                                                         |
| Send message | `POST /sessions/:id/messages`                         | `POST /message`                                                        |
| Get messages | `GET /sessions/:id/messages`                          | `GET /messages`                                                        |
| Events       | `GET /sessions/:id/events`                            | `GET /events`                                                          |
| Status       | Implicit via events                                   | Explicit `GET /status`                                                 |
| Permissions  | `POST /sessions/:id/permissions/:id`                  | Prompts passed through as messages (user responds via `POST /message`) |

## Orca Changes Needed

### 1. New Backend Type: `claude-remote`

Add a `claude-remote` backend configuration alongside the existing `opencode-remote`:

```
backend: claude-remote
url: https://agent-remote.<account>.workers.dev/claude/<project-id>
token: <AUTH_TOKEN>
```

### 2. API Client

Create a new API client module for the AgentAPI protocol:

- `getMessages()` → `GET /messages`
- `sendMessage(content)` → `POST /message`
- `getStatus()` → `GET /status`
- `subscribeEvents()` → `GET /events` (SSE)

### 3. Message Rendering

AgentAPI messages have a simpler structure than OpenCode's. The message renderer needs to handle:

- Agent messages from `role: "agent"` (mapped to `"assistant"` in Orca)
- User messages from `role: "user"`
- No tool-call metadata (AgentAPI abstracts this away)
- Content is plain text formatted as it appears in the agent's terminal (80 chars/line by default)

### 4. UI Changes

- **Backend picker**: Add "Claude Code (Remote)" option alongside "OpenCode (Remote)"
- **Status indicator**: Map AgentAPI status values (`stable`/`running`) to Orca's UI states
- **Permission prompts**: All tools are auto-allowed via `settings.json`. A `PreToolUse` hook blocks remote writes (`git push`, `gh pr/issue`) — Claude reports the block as a message and asks the user for approval before retrying

### 5. Connection Flow

1. User configures a `claude-remote` backend with URL and token
2. Orca connects to `GET /events` for real-time updates
3. On send, Orca `POST /message` and waits for SSE updates
4. Messages are fetched via `GET /messages` on initial load or reconnect
