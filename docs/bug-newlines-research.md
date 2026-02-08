# Bug: Extra newlines in terminal on session open

## Symptom
Every time you open (or close+reopen) a session's terminal view in Orca,
a blank line / newline is injected into the tmux pane content below the
prompt. The newline accumulates — each open adds one more.

## Architecture
- Frontend: xterm.js terminal in React (`src/components/TerminalView.tsx`)
- Backend: Rust PTY via `portable-pty` 0.8 (`src-tauri/src/pty.rs`)
- Flow: `attach_pty` opens a PTY → spawns `tmux attach-session -t <name>` →
  reader thread streams output via Tauri Channel → xterm.js renders
- Close: `close_pty` kills the child process (SIGKILL)

## What has been tried (all FAILED to fix it)

### 1. Gating onData during handshake
- Added `inputEnabled` flag, suppress all xterm.js `onData` forwarding to
  `write_pty` until the initial tmux output burst settles (~100ms).
- Also expanded the terminal response regex filter to catch CPR (`\e[..R`)
  and DSR (`\e[..n`) in addition to DA1/DA2.
- **Result**: Still happens. The newline is NOT from query responses leaking.

### 2. Preventing window resize on disconnect
- Set `tmux set-option -t <session> window-size manual` before killing child
  in `close_pty`, to prevent tmux from resizing to `default-size` (80x24)
  when the last client disconnects.
- **Result**: Still happens.

### 3. Removing window-size=latest before attach
- Removed the `tmux set-option window-size latest` that ran BEFORE the
  client connected in `attach_pty`. With zero clients, this caused tmux to
  fall back to default-size, triggering SIGWINCH.
- **Result**: Still happens.

### 4. Opening PTY at tmux pane's current size
- Added `query_tmux_pane_size()` that runs
  `tmux display-message -t <session> -p '#{window_width} #{window_height}'`
- Opens PTY at pane size instead of xterm.js container size
- Returns actual size to JS, which resizes xterm.js to match
- Defers fitAddon.fit() and resize_pty until after markReady
- Gates onResize handler with same inputEnabled flag
- **Result**: Still happens.

## Theories that were investigated

### Terminal query responses leaking as input
- xterm.js auto-responds to DA1, DA2, CPR, DSR queries from tmux
- These go through `onData` → `write_pty` → PTY input → tmux
- Filtered DA responses; gated all input during handshake
- **Ruled out**: Gating ALL onData didn't fix it

### SIGWINCH from resize during attach/detach
- With `window-size latest`, disconnecting causes resize to 80x24
- Reconnecting causes resize to container size
- Each SIGWINCH might cause inner process to redraw with newline
- **Partially ruled out**: Even with zero resizes (PTY matches pane),
  issue persists. SIGWINCH may not be the cause.

### Investigated and ruled out
1. **portable_pty 0.8 initial bytes on macOS**: `openpty()` does not send
   any initial bytes. The PTY line discipline starts clean.
2. **tmux attach-session itself**: Does NOT write any bytes to the pane on
   attach. It calls `recalculate_sizes()` which may trigger SIGWINCH, but
   does not inject characters. (Confirmed via tmux source: `cmd-attach-session.c`)
3. **tmux client connect event / hooks**: The `client-attached` hook fires
   but does nothing by default. No input is sent to the pane.
4. **tmux alternate screen buffer**: tmux manages pane content server-side,
   independent of client connections. Client death doesn't corrupt pane content.
5. **xterm.js focus events**: `terminal.focus()` does NOT generate `onData`
   events unless focus reporting mode (DECSET 1004) is enabled by the
   application in the pane (e.g., Claude Code). Even then, it sends
   `\x1b[I`/`\x1b[O`, not a newline.

## ROOT CAUSE FOUND

### portable-pty `UnixMasterWriter::Drop` injects `\n` + EOF

**File**: `portable-pty-0.8.1/src/unix.rs` lines 351-363

```rust
impl Drop for UnixMasterWriter {
    fn drop(&mut self) {
        let mut t: libc::termios = unsafe { std::mem::MaybeUninit::zeroed().assume_init() };
        if unsafe { libc::tcgetattr(self.fd.0.as_raw_fd(), &mut t) } == 0 {
            // EOF is only interpreted after a newline, so if it is set,
            // we send a newline followed by EOF.
            let eot = t.c_cc[libc::VEOF];
            if eot != 0 {
                let _ = self.fd.0.write_all(&[b'\n', eot]);
            }
        }
    }
}
```

When the PTY writer is dropped, portable-pty deliberately writes `\n` (0x0A)
followed by the EOF character (Ctrl-D, 0x04) to the PTY master. This is
designed for wezterm's use case (cleanly terminating a shell), but in Orca's
architecture the PTY is a bridge to `tmux attach-session`, and the `\n` leaks
into the still-running tmux pane.

### The race condition in `close_pty`

Rust drops struct fields in **declaration order**. `PtySession` declares
`writer` first, so the drop sequence is:

1. `session.child.kill()` sends SIGKILL to `tmux attach-session`
2. End of scope: `session` is dropped
3. **`writer` drops first** → writes `\n` + EOF to PTY master
4. `master` drops → closes PTY master fd
5. `child` drops

SIGKILL is asynchronous — the `tmux attach` process may still be alive at
step 3, reads the `\n` from its stdin (the PTY slave), and forwards it to the
tmux server, which writes it to the pane. This is why each open/close cycle
adds exactly one newline.

### The fix

Wait for the child process to fully exit after killing it, before the
`PtySession` is dropped. Once the child is dead, the PTY slave fd is closed,
and the `\n` written by the writer's Drop goes into a dead PTY buffer that
nobody reads — it never reaches the tmux pane.

```rust
let _ = session.child.kill();
let _ = session.child.wait(); // Ensure child is dead before writer Drop sends \n
```

## Key files
- `src-tauri/src/pty.rs` — PTY management (attach, write, resize, close)
- `src/components/TerminalView.tsx` — xterm.js terminal component
- `src-tauri/src/tmux.rs` — tmux session listing (read-only)
- `src/styles.css` — terminal CSS (opacity transition, no layout changes)
