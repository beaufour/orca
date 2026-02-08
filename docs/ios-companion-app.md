# Orca iOS Companion App - Research & Plan

## Executive Summary

An iOS companion app for Orca is feasible but requires a **client-server architecture** -- the iOS app cannot run agent-deck, tmux, git, or read local files. iOS prohibits spawning child processes (`fork()`, `posix_spawn()` are blocked) and sandboxes all file access to the app container. The iOS app must be a thin client that talks to the macOS Orca app over the network.

**Difficulty: Medium.** The hardest part is not the iOS app itself -- it's adding a network server to the macOS app. Once that server exists, the iOS app is a straightforward status dashboard.

**Estimated scope:**
- Server component (Rust, in Orca macOS): ~1-2 weeks
- iOS app (depending on approach): 1-5 weeks
- Total: 2-7 weeks depending on approach chosen

---

## Why You Can't Just Port Orca to iOS

Orca's entire backend relies on capabilities iOS forbids:

| Orca Backend Module | What It Does | iOS Blocker |
|---|---|---|
| `agentdeck.rs` | Reads `~/.agent-deck/.../state.db`, shells out to `agent-deck add` | No filesystem access outside sandbox, no process spawning |
| `claude_logs.rs` | Reads `~/.claude/projects/.../*.jsonl` | Files don't exist on iOS |
| `git.rs` | Shells out to `git worktree`, `git merge`, etc. | No git binary, no process spawning |
| `tmux.rs` | Shells out to `tmux list-sessions` | No tmux, no process spawning |
| `pty.rs` | Spawns PTY, attaches to tmux sessions | No PTY support on iOS |

**Conclusion:** Tauri Mobile, despite supporting iOS builds, cannot help here. The Rust backend would need to be completely rewritten as a network client, negating any code-sharing benefit.

---

## Architecture: What Needs to Change

```
┌──────────────────────────────────────────────────────┐
│                    macOS (Orca)                       │
│                                                      │
│  Tauri App (existing)                                │
│  ├── React Frontend (existing, unchanged)            │
│  └── Rust Backend (existing, unchanged)              │
│       ├── agentdeck.rs                               │
│       ├── claude_logs.rs                             │
│       ├── git.rs / tmux.rs / pty.rs                  │
│       │                                              │
│       └── NEW: Embedded Server (axum)  ◄── addition  │
│            ├── REST API (GET sessions, summaries)    │
│            ├── WebSocket (real-time status, terminal) │
│            ├── Bonjour advertisement (_orca._tcp)    │
│            └── Token-based auth (pairing)            │
└─────────────────┬────────────────────────────────────┘
                  │ LAN / Tailscale
┌─────────────────▼────────────────────────────────────┐
│                  iOS Companion App                    │
│                                                      │
│  ├── Bonjour Discovery (find Mac on LAN)             │
│  ├── WebSocket Client (real-time updates)            │
│  ├── REST Client (fetch sessions, summaries)         │
│  ├── Push Notifications (attention alerts)           │
│  └── UI: session list, status, summaries, input      │
└──────────────────────────────────────────────────────┘
```

The macOS app gets a new embedded server. Everything else stays the same. The iOS app is a new, separate codebase.

---

## Part 1: Server Component (macOS Side)

### Technology: axum (Rust)

axum is the natural choice -- it's built on tokio (which Tauri v2 already uses), supports both REST and WebSocket on a single port, and is the most popular Rust web framework.

### API Design

```
Port: 19876 (configurable)

REST endpoints:
  GET  /api/groups                         → list groups
  GET  /api/sessions?group=<path>          → list sessions (optionally by group)
  GET  /api/sessions/:id                   → session detail + summary
  GET  /api/sessions/:id/terminal?lines=N  → last N lines of terminal output
  POST /api/sessions/:id/input             → send text input to session
  POST /api/sessions                       → create new session
  DELETE /api/sessions/:id                 → remove session
  GET  /api/attention                      → attention counts + flagged sessions

WebSocket:
  WS /ws                                   → real-time event stream
    Server → Client:
      { "type": "session_update", "session": { ... } }
      { "type": "attention", "session_id": "...", "status": "needs_input" }
      { "type": "terminal_output", "session_id": "...", "data": "base64..." }
      { "type": "summary_update", "session_id": "...", "summary": "..." }
    Client → Server:
      { "type": "subscribe_terminal", "session_id": "..." }
      { "type": "unsubscribe_terminal", "session_id": "..." }
      { "type": "send_input", "session_id": "...", "text": "..." }
```

### Service Discovery: Bonjour

The server advertises itself as `_orca._tcp` on the local network using the `mdns-sd` Rust crate. The iOS app discovers it automatically -- zero configuration.

### Authentication: Pairing Code

1. First connection: Mac displays a 6-digit pairing code in the Orca UI
2. User enters code on iOS app
3. Server returns a long-lived auth token
4. Token stored in iOS Keychain, included in all subsequent requests
5. Mac validates token on every WebSocket connect and REST request

### Implementation Effort

| Component | Estimated Lines | Notes |
|---|---|---|
| axum server setup + routing | ~100 | Spawn in Tauri `setup` hook |
| REST handlers (reuse existing Rust functions) | ~200 | Thin wrappers around existing `agentdeck.rs`, `claude_logs.rs` |
| WebSocket handler + event broadcasting | ~200 | Poll existing data sources, push diffs |
| Bonjour advertisement | ~30 | `mdns-sd` crate |
| Auth (pairing + token validation) | ~100 | |
| **Total** | **~630** | |

The REST handlers are thin because the existing Rust functions (`get_groups()`, `get_sessions()`, `get_session_summary()`, etc.) already do all the work. The server just calls them and serializes the result as JSON (they already derive `serde::Serialize`).

---

## Part 2: iOS App Approaches (Ranked)

### Option A: Capacitor (Recommended Starting Point)

**What:** Wrap the existing React UI in a native iOS shell. Replace `invoke()` calls with `fetch()`/WebSocket.

| Aspect | Detail |
|---|---|
| Code reuse | ~90% of frontend (all components, CSS, types) |
| Build effort | 1-2 weeks |
| Maintenance | Low -- changes to React components apply to both platforms |
| iOS quality | Adequate (WebView-based, not pixel-perfect native feel) |
| Bonjour | Requires a small custom Capacitor plugin in Swift (~50 lines) or manual IP entry |

**Changes to existing code:**
- Create a shared API client module that replaces all `invoke()` calls with HTTP/WebSocket
- The desktop app uses `invoke()` via Tauri; the iOS app uses `fetch()` via the same API client
- Add `capacitor.config.ts` and iOS project
- Adjust CSS for mobile viewport (safe areas, touch targets)
- Terminal view: read-only streaming (no PTY attach, just last N lines via REST/WS)

**Pros:** Fastest path to a working iOS app. Minimal new code.
**Cons:** WebView rendering. Not "native feel." Bonjour needs a small plugin.

### Option B: Native SwiftUI (Best Long-Term Quality)

**What:** Purpose-built iOS app in Swift/SwiftUI.

| Aspect | Detail |
|---|---|
| Code reuse | None (UI). Possible for Rust models via UniFFI. |
| Build effort | 3-5 weeks |
| Maintenance | Medium -- every new feature needs parallel Swift implementation |
| iOS quality | Excellent -- native navigation, gestures, widgets |
| Bonjour | First-class (`NWBrowser` is native) |

**Unique capabilities over Capacitor:**
- iOS Home Screen widgets showing attention count / session status at a glance
- Background App Refresh to periodically check session status
- Native push notification handling with rich notifications
- Proper iOS navigation (swipe back, pull to refresh, haptic feedback)
- Spotlight integration (search sessions from iOS home screen)

**Pros:** Best user experience. Full access to iOS platform features.
**Cons:** Requires Swift/iOS knowledge. Higher initial and ongoing effort.

### Option C: React Native / Expo

| Aspect | Detail |
|---|---|
| Code reuse | ~10-15% (TypeScript types, business logic) |
| Build effort | 3-5 weeks |
| Maintenance | Medium-high (RN upgrades, dual UI codebases) |
| iOS quality | Good (near-native rendering) |
| Bonjour | Via `react-native-zeroconf` (works but has quirks) |

**Not recommended** for this use case. React Native requires rewriting all UI components anyway (no HTML/CSS), so you don't save much over SwiftUI while taking on the React Native maintenance burden.

### Option D: PWA (Simplest, Most Limited)

| Aspect | Detail |
|---|---|
| Code reuse | ~95% |
| Build effort | Days (just add server + replace invoke()) |
| Maintenance | Minimal |
| iOS quality | Poor (no background, unreliable push, manual IP) |
| Bonjour | Not available in browser |

**Viable as a stopgap** if you want something immediately. The macOS server serves the React UI directly, and you open it in Safari on iPhone. No App Store needed. But the lack of push notifications and background processing means you lose the main value proposition: knowing when sessions need attention while your phone is in your pocket.

### Approaches NOT Recommended

- **Tauri Mobile**: Backend must be completely rewritten (local → network); iOS support is still rough
- **Flutter**: Zero code reuse, different language (Dart), maximum effort for no unique benefit

---

## Part 3: Communication & Connectivity

### Tier 1: LAN (Primary)

```
iOS ──Bonjour discover──► Mac (_orca._tcp on port 19876)
iOS ──WebSocket──────────► Mac (real-time events)
iOS ──REST───────────────► Mac (queries)
```

- Zero configuration. iPhone and Mac on same Wi-Fi, it just works.
- Latency: <10ms for REST, real-time for WebSocket.

### Tier 2: Remote via Tailscale

```
iOS (Tailscale) ──WireGuard tunnel──► Mac (Tailscale)
                                      └── same WebSocket/REST on 100.x.x.x:19876
```

- Install Tailscale on both devices (free for personal use, up to 100 devices).
- Mac gets a stable Tailscale IP (e.g., `100.64.1.2`). iOS app stores it.
- End-to-end WireGuard encryption. No port forwarding or public IP needed.
- Works from anywhere in the world.

### Tier 3: Push Notifications (Passive Alerting)

```
Mac ──APNs HTTP/2──► Apple Push Service ──► iOS
```

- When a session enters `needs_input` or `error` and the iOS app's WebSocket is not connected.
- Mac sends push directly to APNs using the `a2` Rust crate.
- Requires Apple Developer Program ($99/year) and an APNs auth key.
- Notifications appear even when the app is closed.

### Connection Flow

```
1. App opens
2. Try Bonjour discovery for _orca._tcp (LAN)
3. If found → connect WebSocket, authenticate with stored token
4. If not found → try stored Tailscale address
5. If neither → show "offline" with last-known status
6. APNs notifications arrive regardless of connection state
```

---

## Part 4: Recommended Plan

### Phase 1: Server Component (macOS)

Add the embedded axum server to Orca's Rust backend. This is required regardless of which iOS approach is chosen and also enables a PWA stopgap.

**Deliverables:**
- axum server with REST API for sessions, groups, attention, summaries
- WebSocket endpoint for real-time events
- Bonjour advertisement via `mdns-sd`
- Token-based pairing/auth
- New Cargo dependencies: `axum`, `tokio` (already present via Tauri), `mdns-sd`, `a2` (APNs)

### Phase 2: Capacitor iOS App (Quick Win)

Wrap the existing React frontend in Capacitor for a fast iOS app.

**Deliverables:**
- Shared API client replacing `invoke()` with `fetch()`/WebSocket
- Capacitor project with iOS configuration
- Mobile-adjusted CSS (safe areas, touch targets, responsive layout)
- Connection screen (pairing, Tailscale address input)
- Small Capacitor plugin for Bonjour discovery (Swift, ~50 lines)

### Phase 3: Native SwiftUI App (Optional, Long-Term)

If the Capacitor app proves useful but the WebView experience is unsatisfying:

**Deliverables:**
- SwiftUI app with native navigation and session list
- Home Screen widget (attention count, session status)
- Background App Refresh for periodic status checks
- Rich push notifications with inline reply (send input from notification)
- Bonjour + Tailscale connection management

---

## Maintenance Burden Assessment

| Component | Ongoing Work |
|---|---|
| **Server (Rust)** | Low. API changes only when Orca's data model changes. Most changes are frontend-only. |
| **Capacitor iOS** | Low. React UI changes automatically apply. Only mobile-specific CSS and the Capacitor plugin need separate maintenance. |
| **SwiftUI iOS** | Medium. Every new Orca feature that should appear on mobile needs a parallel SwiftUI implementation. Mitigated by the iOS app being a simpler subset of the desktop UI. |
| **Push Notifications** | Low. Once configured, the attention-detection logic already exists in `claude_logs.rs`. |

### What Triggers iOS App Changes

| Orca Change | Capacitor Impact | SwiftUI Impact |
|---|---|---|
| New session card field | Automatic (shared React) | Must add to Swift view |
| New attention status type | Automatic (shared React) | Must add to Swift enum + UI |
| New API endpoint | Add to shared API client | Add to Swift API client |
| CSS theme change | Automatic | Must update SwiftUI colors |
| New Tauri command | Add REST wrapper + shared client call | Add REST wrapper + Swift call |

---

## Key Risks

1. **Apple Developer Program requirement**: Push notifications and App Store distribution require a $99/year Apple Developer account. Capacitor/PWA without push can skip this.

2. **iOS local network permission**: Since iOS 14, apps need user permission for local network access. Users will see a "Orca wants to find and connect to devices on your local network" prompt. If denied, Bonjour won't work (must fall back to manual IP).

3. **WebSocket backgrounding**: iOS kills WebSocket connections ~30 seconds after the app is backgrounded. The app must reconnect on foreground. Push notifications fill the gap for attention alerts.

4. **Server security**: The embedded server gives network access to terminal sessions. Token-based auth is the minimum. Consider also binding to localhost + Tailscale interface only (not `0.0.0.0`) to avoid exposure on untrusted networks.

5. **axum + Tauri coexistence**: Both use tokio. The axum server should be spawned as a background task in the Tauri `setup` hook. No conflicts expected, but async runtime sharing needs testing.
