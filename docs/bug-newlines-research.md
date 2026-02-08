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

Two interacting issues combine to cause the bug:

### 1. portable-pty `UnixMasterWriter::Drop` injects `\n` + EOF

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

### 2. React strict mode causes silent double-attach (the actual trigger)

In development, React strict mode double-fires effects. The `TerminalView`
component's effect calls `attach_pty` twice in quick succession for the same
session ID — first at 80x24 (xterm.js default before layout), then at the
real container size (e.g. 124x48).

The second `attach_pty` call inserts a new `PtySession` into the HashMap with
the same key. **The old PtySession is silently dropped** by `HashMap::insert`.
This drop was uncontrolled:

1. The old session's `child` (tmux attach) was never killed — still alive
2. The old session's `writer` drops → `UnixMasterWriter::Drop` fires
3. Drop writes `\n` + EOF to the PTY master
4. The still-alive tmux attach child reads the `\n` from its PTY slave
5. tmux forwards the `\n` to the pane — **newline injected**

This is why the newline appeared on every open: it was triggered by the
double-mount replacing the first PtySession, not by the explicit close.

### Diagnostic evidence

Pane capture logging confirmed:

- BEFORE-ATTACH: 13 lines
- AFTER-SET-WINDOW-SIZE: 13 lines (no change)
- AFTER-ATTACH-SETTLED (500ms): **14 lines** ← newline injected during attach
- BEFORE-CLOSE: 14 lines (no new change)
- AFTER-CLOSE-SETTLED: 14 lines (close was never the problem)

The `attach_pty` log showed two calls at the same timestamp with different
sizes but the same session_id, confirming the React strict mode double-mount.

### The fix

Two changes in `pty.rs`:

**a) `shutdown_session()` helper**: Kills the child, waits for it to fully
exit, then lets the PtySession drop. The child being dead means its PTY slave
fd is closed, so the writer's Drop `\n` goes into a dead buffer.

**b) `attach_pty` cleans up existing sessions**: Before inserting a new
PtySession, checks if one already exists with the same session_id and runs
`shutdown_session()` on it. This prevents the silent uncontrolled drop from
`HashMap::insert`.

```rust
// In attach_pty, before inserting:
if let Some(old) = sessions.remove(&session_id) {
    shutdown_session(old);  // kill + wait, then controlled drop
}
sessions.insert(session_id, session);
```

### Why only `child.wait()` in close_pty wasn't enough

The initial fix only added `child.wait()` to `close_pty`. This didn't help
because the newline was never injected during close — it was injected during
**attach** when the HashMap silently dropped the replaced PtySession. The
old session's child was never killed (only the HashMap drop ran), so
`child.wait()` in close_pty was fixing the wrong code path.

## Key files

- `src-tauri/src/pty.rs` — PTY management (attach, write, resize, close)
- `src/components/TerminalView.tsx` — xterm.js terminal component
- `src-tauri/src/tmux.rs` — tmux session listing (read-only)
- `src/styles.css` — terminal CSS (opacity transition, no layout changes)
