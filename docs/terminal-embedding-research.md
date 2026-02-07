# Terminal Embedding Research (2026-02-07)

## Current Architecture

Orca uses xterm.js v6 (WebGL addon) in the React frontend + portable-pty 0.8 on the Rust backend. Data flows:
- **Output**: PTY reader thread → base64 encode → Tauri event → JS decode → xterm.js write
- **Input**: xterm.js onData → base64 encode → invoke("write_pty") → PTY master write
- **Resize**: FitAddon + ResizeObserver → invoke("resize_pty") → PTY resize

## Native Terminal Embedding — Not Feasible

### Cross-process window embedding (Alacritty, Kitty, WezTerm, etc.)
**Not possible on macOS.** Unlike Windows HWND handles, macOS does not support cross-process NSView reparenting. You cannot take an NSView from Alacritty's process and insert it into Tauri's view hierarchy.

### In-process options

| Approach | Maturity | Effort | Notes |
|---|---|---|---|
| **alacritty_terminal** crate (v0.25) | Mature | High | Terminal emulation engine only — no renderer. You'd need to serialize grid state to webview or use egui/iced. Projects: egui_term, iced_term. |
| **libghostty** (Zig) | Early | Medium (later) | VT parser available (libghostty-vt). GPU rendering & stable C API not yet shipped. Proof-of-concept: gpui-ghostty. Expected stable ~March 2026. |
| **SwiftTerm** (NSView) | Mature | High | Native macOS terminal view by Miguel de Icaza. Could sit alongside webview via tauri-nssplitview plugin. Requires Swift-Rust bridging, layout/focus coordination. macOS-only. |
| **WezTerm libs** | Fragmented | High | `wezterm-term` not published to crates.io. `termwiz` is for TUI apps, not embedding. |
| **Overlay/companion window** | N/A | Low | Fragile UX — two separate windows, independent focus, no visual integration. |

### Performance comparison

| Terminal | Average Latency |
|---|---|
| Alacritty | ~7ms |
| Kitty (tuned) | ~11ms |
| WezTerm | ~26ms |
| xterm.js (WebGL) | ~40ms |

For viewing Claude Code sessions (mostly reading AI output), the 30ms gap is imperceptible.

## Tauri-specific Notes

- **Tauri exposes NSWindow/NSView** via `ns_view()`, `raw_window_handle()`, and `with_webview`. Native views can coexist with the webview (proven by tauri-nssplitview plugin).
- **Tauri Channels** (`tauri::ipc::Channel<T>`) are designed for streaming and avoid base64/JSON overhead of events. Recommended for PTY output streaming.
- **tauri-plugin-pty** (v0.1.1 by Tnze) exists but only spawns new shells — doesn't support attaching to existing tmux sessions.

## Existing Tauri + xterm.js Projects

- **tauri-terminal** (marc2332, 113 stars) — minimal reference implementation
- **Terminon** — full-featured with SSH, WSL, split panes
- **claude-code-gui** — Claude Code desktop GUI with integrated terminal
- **terraphim-liquid-glass-terminal** — macOS liquid glass design effects

## tmux Multi-Client Considerations

- Multiple clients attached to same session: window navigation is synchronized
- Window sizing defaults to smallest client — use `window-size latest` to size based on most recently active client
- Session groups (`tmux new-session -t <target>`) allow independent window focus but add complexity

## Decision

**Stick with xterm.js.** Improve the existing implementation:
1. Switch from Tauri events to Channels for PTY streaming (eliminates base64 overhead)
2. Add resize debouncing (200ms)
3. Set `window-size latest` on tmux sessions

**Future watch:** libghostty GPU rendering — once stable C API + Metal/OpenGL surface support ships, it could provide a drop-in embeddable terminal.

## Sources

- [alacritty_terminal on crates.io](https://crates.io/crates/alacritty_terminal)
- [libghostty announcement](https://mitchellh.com/writing/libghostty-is-coming)
- [gpui-ghostty](https://github.com/Xuanwo/gpui-ghostty)
- [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm)
- [tauri-nssplitview](https://github.com/Vanalite/tauri-nssplitview)
- [tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty)
- [Terminal latency benchmarks](https://beuke.org/terminal-latency/)
- [Tauri v2 Channels docs](https://v2.tauri.app/develop/calling-rust/)
- [tauri-terminal](https://github.com/marc2332/tauri-terminal)
