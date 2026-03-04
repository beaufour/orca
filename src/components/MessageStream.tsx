import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RemoteMessage, RemoteSession } from "../types";

interface DebugEntry {
  time: string;
  direction: "send" | "recv" | "event" | "error";
  label: string;
  detail?: string;
}

function timestamp(): string {
  const d = new Date();
  return (
    d.toLocaleTimeString("en-US", { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

interface MessageStreamProps {
  session: RemoteSession;
  serverUrl: string;
  serverPassword: string;
  backend: "opencode-remote" | "claude-remote";
  initialPrompt?: string | null;
  onClose: () => void;
}

export function MessageStream({
  session,
  serverUrl,
  serverPassword,
  backend,
  initialPrompt,
  onClose,
}: MessageStreamProps) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>(session.status);
  const [elapsed, setElapsed] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debugEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isClaude = backend === "claude-remote";

  const addDebug = useCallback(
    (direction: DebugEntry["direction"], label: string, detail?: string) => {
      setDebugLog((prev) => [...prev, { time: timestamp(), direction, label, detail }]);
    },
    [],
  );

  // Log mount info
  useEffect(() => {
    addDebug(
      "event",
      "MessageStream mounted",
      `backend=${backend}\nserverUrl=${serverUrl}\ntoken=${serverPassword ? serverPassword.slice(0, 8) + "..." : "(empty)"}\nsession=${JSON.stringify(session, null, 2)}\ninitialPrompt=${initialPrompt ?? "(none)"}`,
    );
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session isn't ready until the agent prompt appears
  const waitingForAgent = isClaude && messages.length === 0 && !error;
  const showWaiting = loading || waitingForAgent;

  // Elapsed timer while waiting
  useEffect(() => {
    if (!showWaiting || !isClaude) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [showWaiting, isClaude]);

  // Load message history
  useEffect(() => {
    setLoading(true);
    const cmd = isClaude ? "cr_get_messages" : "oc_get_messages";
    const params = isClaude
      ? { serverUrl, token: serverPassword }
      : { serverUrl, password: serverPassword, sessionId: session.id };
    addDebug("send", `${cmd}`, JSON.stringify(params, null, 2));

    const promise = invoke<RemoteMessage[]>(cmd, params);

    promise
      .then((msgs) => {
        addDebug("recv", `${cmd} OK`, `${msgs.length} message(s)`);
        setMessages(msgs);
        setLoading(false);
      })
      .catch((err) => {
        addDebug("error", `${cmd} FAILED`, String(err));
        setError(String(err));
        setLoading(false);
      });
  }, [session.id, serverUrl, serverPassword, isClaude, addDebug]);

  // Start SSE subscription for claude-remote (with retry on failure)
  useEffect(() => {
    if (!isClaude) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    const trySubscribe = (attempt: number) => {
      if (cancelled) return;
      addDebug("send", `cr_subscribe_events${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      invoke("cr_subscribe_events", { serverUrl, token: serverPassword })
        .then(() => addDebug("recv", "cr_subscribe_events OK"))
        .catch((err) => {
          addDebug("error", "cr_subscribe_events FAILED", String(err));
          // Retry with backoff (3s, 6s, 12s, max 30s) — container may still be starting
          if (!cancelled) {
            const delay = Math.min(3000 * Math.pow(2, attempt - 1), 30000);
            addDebug("event", `SSE retry in ${delay / 1000}s`);
            retryTimer = setTimeout(() => trySubscribe(attempt + 1), delay);
          }
        });
    };

    trySubscribe(1);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [isClaude, serverUrl, serverPassword, addDebug]);

  // Send initial prompt on mount (claude-remote)
  useEffect(() => {
    if (!isClaude || !initialPrompt) return;
    addDebug(
      "send",
      "cr_send_message (initial)",
      `content="${initialPrompt.slice(0, 100)}${initialPrompt.length > 100 ? "..." : ""}"`,
    );
    invoke("cr_send_message", {
      serverUrl,
      token: serverPassword,
      content: initialPrompt,
    })
      .then(() => addDebug("recv", "cr_send_message (initial) OK"))
      .catch((err) => {
        addDebug("error", "cr_send_message (initial) FAILED", String(err));
        setError(`Failed to send initial message: ${String(err)}`);
      });
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether SSE is connected (to enable/disable polling fallback)
  const sseConnectedRef = useRef(false);

  // Listen to SSE events
  useEffect(() => {
    const eventName = isClaude ? "cr-event" : "oc-event";
    const unlisten = listen<{ event_type: string; data: Record<string, unknown> }>(
      eventName,
      (event) => {
        sseConnectedRef.current = true;
        const { event_type, data } = event.payload;
        addDebug("event", `SSE ${event_type}`, JSON.stringify(data).slice(0, 200));
        // AgentAPI uses "message_update"/"status_change"; OpenCode uses "message"/"status"
        const isMessageEvent = event_type === "message_update" || event_type === "message";
        const isStatusEvent = event_type === "status_change" || event_type === "status";
        if (isMessageEvent && data) {
          if (isClaude) {
            // For claude-remote, re-fetch all messages (handles both new and updated)
            addDebug("send", "cr_get_messages (SSE refresh)");
            invoke<RemoteMessage[]>("cr_get_messages", {
              serverUrl,
              token: serverPassword,
            })
              .then((msgs) => {
                addDebug("recv", "cr_get_messages (SSE refresh) OK", `${msgs.length} message(s)`);
                setMessages(msgs);
              })
              .catch((err) => {
                addDebug("error", "cr_get_messages (SSE refresh) FAILED", String(err));
                console.error("Failed to refresh messages:", err);
              });
          } else if (
            "session_id" in data &&
            data.session_id === session.id &&
            "id" in data &&
            "role" in data
          ) {
            setMessages((prev) => [...prev, data as unknown as RemoteMessage]);
          }
        } else if (isStatusEvent && isClaude && data) {
          if ("status" in data && typeof data.status === "string") {
            setAgentStatus(data.status);
          }
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [session.id, isClaude, serverUrl, serverPassword, addDebug]);

  // Poll messages as fallback while SSE is not connected (claude-remote only)
  useEffect(() => {
    if (!isClaude) return;
    const interval = setInterval(() => {
      if (sseConnectedRef.current) return; // SSE is handling updates
      invoke<RemoteMessage[]>("cr_get_messages", {
        serverUrl,
        token: serverPassword,
      })
        .then((msgs) => {
          if (msgs.length > 0) {
            addDebug("recv", "poll OK", `${msgs.length} message(s)`);
            setMessages(msgs);
          }
        })
        .catch(() => {}); // Silently ignore poll failures
    }, 5000);
    return () => clearInterval(interval);
  }, [isClaude, serverUrl, serverPassword, addDebug]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-scroll debug panel
  useEffect(() => {
    if (debugMode) {
      debugEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [debugLog, debugMode]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");
    const cmd = isClaude ? "cr_send_message" : "oc_send_message";
    addDebug("send", cmd, `content="${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);
    try {
      if (isClaude) {
        await invoke("cr_send_message", {
          serverUrl,
          token: serverPassword,
          content: text,
        });
      } else {
        await invoke("oc_send_message", {
          serverUrl,
          password: serverPassword,
          sessionId: session.id,
          message: text,
        });
      }
      addDebug("recv", `${cmd} OK`);
    } catch (err) {
      addDebug("error", `${cmd} FAILED`, String(err));
      setError(String(err));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, sending, serverUrl, serverPassword, session.id, isClaude, addDebug]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="message-stream">
      <div className="message-stream-header">
        <span className="message-stream-title">{session.title || session.id}</span>
        <span className={`message-stream-status status-${isClaude ? agentStatus : session.status}`}>
          {isClaude ? agentStatus : session.status}
        </span>
        <button
          className={`terminal-close ${debugMode ? "debug-active" : ""}`}
          onClick={() => setDebugMode((d) => !d)}
          title="Toggle debug log"
        >
          Debug
        </button>
        <button className="terminal-close" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>

      <div className="message-stream-body">
        {showWaiting &&
          (isClaude ? (
            <div className="message-stream-loading">
              <span className="spinner" />{" "}
              {loading
                ? `Starting remote container... (${elapsed}s)`
                : `Waiting for agent... (${elapsed}s)`}
              {elapsed >= 15 && (
                <div className="message-stream-loading-hint">
                  Cold starts can take a few minutes
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="message-stream-loading">Loading messages...</div>
          ) : null)}
        {error && <div className="wt-error">{error}</div>}
        {!loading &&
          messages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`message-bubble message-${msg.role || "system"} message-type-${msg.type || "text"}`}
            >
              <div className="message-role">{msg.role || "system"}</div>
              <div className="message-content">
                {typeof msg.content === "string" ? (
                  <pre>{msg.content}</pre>
                ) : (
                  <pre>{JSON.stringify(msg.content, null, 2)}</pre>
                )}
              </div>
              {msg.tool_name && <div className="message-tool-name">Tool: {msg.tool_name}</div>}
            </div>
          ))}
        <div ref={messagesEndRef} />
      </div>

      {debugMode && (
        <div className="debug-panel">
          <div className="debug-panel-header">
            <span>Debug Log ({debugLog.length} entries)</span>
            <button className="debug-clear" onClick={() => setDebugLog([])}>
              Clear
            </button>
          </div>
          <div className="debug-panel-body">
            {debugLog.length === 0 && <div className="debug-empty">No entries yet</div>}
            {debugLog.map((entry, i) => (
              <div key={i} className={`debug-entry debug-${entry.direction}`}>
                <span className="debug-time">{entry.time}</span>
                <span className={`debug-badge debug-badge-${entry.direction}`}>
                  {entry.direction === "send"
                    ? "REQ"
                    : entry.direction === "recv"
                      ? "RES"
                      : entry.direction === "event"
                        ? "SSE"
                        : "ERR"}
                </span>
                <span className="debug-label">{entry.label}</span>
                {entry.detail && <pre className="debug-detail">{entry.detail}</pre>}
              </div>
            ))}
            <div ref={debugEndRef} />
          </div>
        </div>
      )}

      <div className="message-stream-input">
        <textarea
          ref={textareaRef}
          className="wt-input message-input-textarea"
          placeholder="Type a message... (Cmd+Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={sending || showWaiting}
          autoFocus
        />
        <button
          className="wt-btn wt-btn-add"
          onClick={handleSend}
          disabled={!input.trim() || sending || showWaiting}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
