import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!containerRef.current || !session.tmux_session) return;

    setAttachFailed(false);

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
    let unlisten: UnlistenFn | null = null;

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

      // Listen for PTY output events
      unlisten = await listen<string>(`pty-output-${sessionId}`, (event) => {
        const bytes = Uint8Array.from(atob(event.payload), (c) =>
          c.charCodeAt(0)
        );
        terminal.write(bytes);
      });

      // Attach to tmux session via PTY
      await invoke("attach_pty", {
        sessionId,
        tmuxSession: session.tmux_session,
        cols,
        rows,
      });

      terminal.focus();
    };

    setup().catch((err) => {
      const msg = String(err);
      if (msg.includes("can't find session") || msg.includes("no server running")) {
        terminal.write(
          `\r\n  \x1b[33mTmux session '${session.tmux_session}' not found.\x1b[0m\r\n` +
          `  The session may have been closed or cleaned up.\r\n` +
          `  Use the Restart button to start a new tmux session.\r\n`
        );
        setAttachFailed(true);
      } else {
        terminal.write(`\r\n  \x1b[31mFailed to attach:\x1b[0m ${msg}\r\n`);
        setAttachFailed(true);
      }
    });

    // Send keystrokes to PTY, filtering out terminal query responses
    // (Device Attributes responses like \e[>0;276;0c that tmux queries
    // but would leak to the shell as typed input)
    const DA_RESPONSE = /\x1b\[[\?>]\d[\d;]*c/g;
    const onDataDisposable = terminal.onData((data) => {
      // Intercept Ctrl+Q to close terminal (matches agent-deck's detach shortcut)
      if (data === "\x11") {
        onCloseRef.current();
        return;
      }
      const filtered = data.replace(DA_RESPONSE, "");
      if (!filtered) return;
      const encoded = btoa(filtered);
      invoke("write_pty", { sessionId, data: encoded }).catch(() => {});
    });

    // Handle resize
    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      invoke("resize_pty", { sessionId, cols, rows }).catch(() => {});
    });

    // Prevent scroll events from bubbling to parent (session cards area)
    const container = containerRef.current;
    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    container.addEventListener("wheel", handleWheel, { passive: true });

    // Fit on container resize (handles window resize + sidebar resize)
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    // Cleanup function
    cleanupRef.current = () => {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", handleWheel);
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (unlisten) unlisten();
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

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await invoke("restart_session", { sessionId: session.id });
      // Invalidate sessions to pick up new tmux_session value
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // Close and let the user re-open with the new tmux session
      onClose();
    } catch (err) {
      terminalRef.current?.write(
        `\r\n  \x1b[31mRestart failed:\x1b[0m ${String(err)}\r\n`
      );
    } finally {
      setRestarting(false);
    }
  }, [session.id, queryClient, onClose]);

  if (!session.tmux_session) {
    return (
      <div className="terminal-view">
        <div className="terminal-header">
          <span className="terminal-title">{session.title}</span>
          <button className="terminal-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="terminal-no-tmux">No tmux session available</div>
      </div>
    );
  }

  return (
    <div className="terminal-view">
      <div className="terminal-header">
        <span className="terminal-title">{session.title}</span>
        <span className="terminal-tmux">{session.tmux_session}</span>
        {attachFailed && (
          <button
            className="wt-btn wt-btn-add"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? "Restarting..." : "Restart"}
          </button>
        )}
        <button className="terminal-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="xterm-container" ref={containerRef} />
    </div>
  );
}
