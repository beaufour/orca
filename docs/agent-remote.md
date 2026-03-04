# Orca Integration: Claude Code Remote Backend

This document describes how [Orca](https://github.com/beaufour/orca) supports the Claude Code remote backend served by agent-remote.

## Overview

Agent-remote exposes two backends:

- **OpenCode** at `/opencode/<id>/*` — multi-session REST API
- **Claude Code** at `/claude/<id>/*` — single-session API via [AgentAPI](https://github.com/coder/agentapi)

Each `<id>` is a **project ID** that identifies a container. Containers are created lazily — the first request to `/claude/<id>/*` triggers container creation and registers the session.

## Authentication

Agent-remote uses two-level authentication:

1. **Cloudflare Access (primary)** — protects all routes at the edge. After login, requests carry a JWT via the `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie. The worker verifies this against the CF Access JWKS endpoint.
2. **Bearer token (fallback for dev)** — `Authorization: Bearer <AUTH_TOKEN>` checked against the `AUTH_TOKEN` env var. Only used when CF Access JWT is absent.

Orca sends the token as `Authorization: Bearer <token>`. If the server is behind Cloudflare Access and the token isn't a valid CF Access JWT, the request will be intercepted and an HTML login page returned instead of JSON.

## Orca Configuration

The user configures the **base URL** of the agent-remote worker (without any session path):

```
backend: claude-remote
url: https://agent-remote.<account>.workers.dev
token: <AUTH_TOKEN>
```

Orca appends `/claude/<projectId>` at session creation time to form the full session URL. The user should **not** include `/claude/<id>` in the configured URL.

## Session Lifecycle

### Creation

Agent-remote has **no explicit session creation endpoint**. Containers are created lazily:

1. Orca generates a unique project ID: `orca-<timestamp>` (e.g., `orca-1709500000000`)
2. Orca constructs the session URL: `<baseUrl>/claude/<projectId>`
3. The first API request to this URL triggers container creation on the server
4. The container starts the AgentAPI process (cold starts can take up to a few minutes)

### Reconnection

When the user closes and reopens a session, Orca reuses the same session URL. The container is still running on the server, so reconnection is instant — `GET /messages` returns the existing conversation and `GET /events` resumes the SSE stream.

### Container States

Containers on the server can be:

- **running** — actively processing or waiting for input
- **stopped** — container has been shut down (TTL expired or manually removed)

Stopped containers cannot be reconnected to. The server returns 404 for their endpoints.

## AgentAPI Protocol

All endpoints below are relative to the session URL (`<baseUrl>/claude/<projectId>`).

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
| Sessions     | Multi-session (`/sessions`, `/sessions/:id/messages`) | Single session per container (no session concept within AgentAPI)      |
| Base URL     | Configured as full URL including `/opencode/<id>`     | Configured as base URL only; Orca appends `/claude/<projectId>`        |
| Creation     | Explicit `POST /session`                              | Lazy — first request to `/claude/<id>/*` creates the container         |
| Send message | `POST /sessions/:id/messages`                         | `POST /message`                                                        |
| Get messages | `GET /sessions/:id/messages`                          | `GET /messages`                                                        |
| Events       | `GET /sessions/:id/events`                            | `GET /events`                                                          |
| Status       | Implicit via events                                   | Explicit `GET /status`                                                 |
| Permissions  | `POST /sessions/:id/permissions/:id`                  | Prompts passed through as messages (user responds via `POST /message`) |

## Connection Flow

1. User configures a `claude-remote` backend with the base URL and token
2. User creates a new session in Orca (via AddSessionBar or TodoList)
3. Orca generates a project ID and constructs the session URL
4. Orca sends the initial prompt via `POST /message` (triggers container creation)
5. Orca connects to `GET /events` for real-time updates (retries with backoff during cold start)
6. Orca polls `GET /messages` as a fallback while SSE is not yet connected
7. Once the container is ready, the agent prompt appears and the user can interact

### Cold Start Handling

Container cold starts can take up to a few minutes. Orca handles this with:

- **5-minute HTTP timeout** on the Rust client (vs 30s for OpenCode)
- **SSE retry with exponential backoff** (3s, 6s, 12s... max 30s) — the `/events` endpoint may 404 until the container is ready
- **Message polling** every 5s as a fallback while SSE is disconnected
- **UI spinner** showing elapsed time, with a hint after 15s that cold starts are expected

## Implementation Files

| File                               | Purpose                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `src-tauri/src/claude_remote.rs`   | Rust API client — HTTP calls to AgentAPI endpoints         |
| `src-tauri/src/remote_common.rs`   | Shared SSE parsing, HTTP client builder, URL normalization |
| `src/components/MessageStream.tsx` | Chat UI — messages, input, SSE listener, debug panel       |
| `src/App.tsx`                      | Session creation — generates project ID, constructs URL    |
