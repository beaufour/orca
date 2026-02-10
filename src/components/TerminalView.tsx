import { useEffect, useRef, useState, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { Session } from "../types";

interface TerminalViewProps {
  session: Session;
  onClose: () => void;
}

export function TerminalView({ session, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [attachFailed, setAttachFailed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!containerRef.current || !session.tmux_session) return;

    setAttachFailed(false);
    setTerminalReady(false);

    // Debounce: reveal terminal after initial data burst settles
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const markReady = () => {
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = setTimeout(() => setTerminalReady(true), 30);
    };

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 0, // tmux manages its own scrollback; disable xterm.js buffer
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, "Courier New", monospace',
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#c9d1d9",
        selectionBackground: "#264f78",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);

    // Try WebGL, fall back to canvas
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // Canvas renderer is the default fallback
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const sessionId = session.id;

    // Defer attach until the container is fully laid out
    const setup = async () => {
      // Wait for layout to settle before fitting
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fitAddon.fit();
            resolve();
          });
        });
      });

      const cols = terminal.cols;
      const rows = terminal.rows;

      // Pre-check: verify tmux session exists before attaching.
      // Retry a few times since agent-deck session start may still be
      // spinning up the tmux session (race between DB write and tmux creation).
      let tmuxReady = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const liveSessions = await invoke<string[]>("list_tmux_sessions");
          if (liveSessions.includes(session.tmux_session!)) {
            tmuxReady = true;
            break;
          }
        } catch {
          // Ignore errors like "no server running" and retry
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!tmuxReady) {
        throw new Error(`can't find session: ${session.tmux_session}`);
      }

      // Stream PTY output via Channel
      const onOutput = new Channel<string>((encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        terminal.write(bytes);
        markReady();
      });

      // Attach to tmux session via PTY
      await invoke("attach_pty", {
        sessionId,
        tmuxSession: session.tmux_session,
        cols,
        rows,
        onOutput,
      });

      terminal.focus();
    };

    setup().catch((err) => {
      const msg = String(err);
      setTerminalReady(true);
      if (msg.includes("can't find session") || msg.includes("no server running")) {
        terminal.write(
          `\r\n  \x1b[33mTmux session '${session.tmux_session}' not found.\x1b[0m\r\n` +
            `  The session may have been closed or cleaned up.\r\n` +
            `  Use the Restart button to start a new tmux session.\r\n`,
        );
        setAttachFailed(true);
      } else {
        terminal.write(`\r\n  \x1b[31mFailed to attach:\x1b[0m ${msg}\r\n`);
        setAttachFailed(true);
      }
    });

    // UTF-8 safe base64 encoding (btoa only handles Latin-1 / 0-255)
    const toBase64 = (str: string): string => {
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };

    // Write raw bytes to PTY (already base64-encoded)
    const writePty = (b64: string) => {
      invoke("write_pty", { sessionId, data: b64 }).catch(() => {});
    };

    // Intercept key events that xterm.js doesn't handle correctly.
    const tmuxSession = session.tmux_session!;
    terminal.attachCustomKeyEventHandler((event) => {
      // Shift+Enter: paste a newline via tmux bracketed paste.
      // Can't use CSI u (\e[13;2u) because Claude Code negotiates the kitty
      // keyboard protocol at startup — before we attach — and since xterm.js
      // can't respond to the capability query, Claude Code falls back to basic
      // mode and ignores CSI u. Bracketed paste works unconditionally.
      // Must block BOTH keydown and keypress to prevent xterm.js from also
      // sending \r (Enter) on the keypress event.
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        if (event.type === "keydown") {
          invoke("paste_to_tmux_pane", { tmuxSession, text: "\n" }).catch(() => {});
        }
        return false;
      }

      if (event.type !== "keydown") return true;
      return true;
    });

    // Send keystrokes to PTY, filtering out terminal query responses
    // (Device Attributes responses like \e[>0;276;0c that tmux queries
    // but would leak to the shell as typed input)
    // eslint-disable-next-line no-control-regex, no-useless-escape -- terminal escape sequences
    const DA_RESPONSE = /\x1b\[[\?>]\d[\d;]*c/g;
    const onDataDisposable = terminal.onData((data) => {
      // Intercept Ctrl+Q to close terminal (matches agent-deck's detach shortcut)
      if (data === "\x11") {
        onCloseRef.current();
        return;
      }
      const filtered = data.replace(DA_RESPONSE, "");
      if (!filtered) return;
      writePty(toBase64(filtered));
    });

    // Handle resize
    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      invoke("resize_pty", { sessionId, cols, rows }).catch(() => {});
    });

    // Scroll via tmux copy-mode since mouse mode is off (for native text selection).
    // Use capture phase so we intercept before xterm.js can stopPropagation().
    // Throttle to avoid overwhelming tmux with rapid scroll events.
    const container = containerRef.current;
    let scrollThrottled = false;
    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (scrollThrottled) return;
      scrollThrottled = true;
      setTimeout(() => (scrollThrottled = false), 16);

      const direction = e.deltaY < 0 ? "up" : "down";
      // Convert pixel delta to lines (deltaMode 0 = pixels, 1 = lines)
      const lines = Math.max(
        3,
        e.deltaMode === 1 ? Math.round(Math.abs(e.deltaY)) : Math.round(Math.abs(e.deltaY) / 8),
      );
      invoke("scroll_tmux_pane", { tmuxSession, direction, lines }).catch(() => {});
    };
    container.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    // Fit on container resize (handles window resize + sidebar resize)
    // Debounce to prevent rapid resize events from overwhelming the PTY
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitAddon.fit(), 200);
    });
    resizeObserver.observe(container);

    // Cleanup function
    cleanupRef.current = () => {
      if (readyTimer) clearTimeout(readyTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      container.removeEventListener("wheel", handleWheel, { capture: true });
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      invoke("close_pty", { sessionId }).catch(() => {});
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [session.id, session.tmux_session]);

  // Handle file drag-and-drop: paste file paths into tmux session
  useEffect(() => {
    if (!session.tmux_session) return;
    const tmuxSession = session.tmux_session;

    // Shell-escape a path by backslash-escaping special characters
    const shellEscape = (path: string) => path.replace(/([ \\'"()&;|<>$`!#*?[\]{}~^])/g, "\\$1");

    // Check if a position (from Tauri drag-drop event) is within the terminal container
    const isOverContainer = (pos: { x: number; y: number }): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      const rect = container.getBoundingClientRect();
      return pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom;
    };

    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { payload } = event;
      if (payload.type === "over" || payload.type === "enter") {
        setIsDragOver(isOverContainer(payload.position));
      } else if (payload.type === "drop") {
        setIsDragOver(false);
        if (isOverContainer(payload.position)) {
          const text = payload.paths.map(shellEscape).join(" ");
          invoke("paste_to_tmux_pane", { tmuxSession, text }).catch(() => {});
          // Refocus the terminal after drop
          terminalRef.current?.focus();
        }
      } else if (payload.type === "leave") {
        setIsDragOver(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [session.tmux_session]);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await invoke("restart_session", { sessionId: session.id });
      // Invalidate and wait for refetch; the parent syncs selectedSession
      // from query data, which re-triggers our setup effect with the new tmux_session
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      terminalRef.current?.write(`\r\n  \x1b[31mRestart failed:\x1b[0m ${String(err)}\r\n`);
    } finally {
      setRestarting(false);
    }
  }, [session.id, queryClient]);

  if (!session.tmux_session) {
    return (
      <div className="terminal-view">
        <div className="terminal-header">
          <span className="terminal-focus-badge">TERMINAL</span>
          <span className="terminal-title">{session.title}</span>
          <button className="wt-btn wt-btn-add" onClick={handleRestart} disabled={restarting}>
            {restarting ? "Restarting..." : "Restart"}
          </button>
          <button
            className="wt-btn wt-btn-action"
            onClick={() => invoke("open_in_terminal", { path: session.project_path })}
            title={`Open iTerm in ${session.project_path}`}
          >
            Term
          </button>
          <button className="terminal-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="terminal-no-tmux">
          No tmux session found. Click Restart to create a new one.
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-view">
      <div className="terminal-header">
        <span className="terminal-focus-badge">TERMINAL</span>
        <span className="terminal-title">{session.title}</span>
        <span className="terminal-tmux">{session.tmux_session}</span>
        {attachFailed && (
          <button className="wt-btn wt-btn-add" onClick={handleRestart} disabled={restarting}>
            {restarting ? "Restarting..." : "Restart"}
          </button>
        )}
        <button
          className="wt-btn wt-btn-action"
          onClick={() => invoke("open_in_terminal", { path: session.project_path })}
          title={`Open iTerm in ${session.project_path}`}
        >
          Term
        </button>
        <button className="terminal-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div
        className={`xterm-container ${terminalReady ? "" : "xterm-container-loading"} ${isDragOver ? "xterm-container-dragover" : ""}`}
        ref={containerRef}
      />
    </div>
  );
}
