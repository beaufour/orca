import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RemoteMessage, RemoteSession } from "../types";

interface MessageStreamProps {
  session: RemoteSession;
  serverUrl: string;
  serverPassword: string;
  backend: "opencode-remote" | "claude-remote";
  onClose: () => void;
}

export function MessageStream({
  session,
  serverUrl,
  serverPassword,
  backend,
  onClose,
}: MessageStreamProps) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>(session.status);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isClaude = backend === "claude-remote";

  // Load message history
  useEffect(() => {
    setLoading(true);
    const promise = isClaude
      ? invoke<RemoteMessage[]>("cr_get_messages", {
          serverUrl,
          token: serverPassword,
        })
      : invoke<RemoteMessage[]>("oc_get_messages", {
          serverUrl,
          password: serverPassword,
          sessionId: session.id,
        });

    promise
      .then((msgs) => {
        setMessages(msgs);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [session.id, serverUrl, serverPassword, isClaude]);

  // Start SSE subscription for claude-remote
  useEffect(() => {
    if (!isClaude) return;
    invoke("cr_subscribe_events", { serverUrl, token: serverPassword }).catch((err) =>
      console.error("Failed to subscribe to SSE:", err),
    );
  }, [isClaude, serverUrl, serverPassword]);

  // Listen to SSE events
  useEffect(() => {
    const eventName = isClaude ? "cr-event" : "oc-event";
    const unlisten = listen<{ event_type: string; data: Record<string, unknown> }>(
      eventName,
      (event) => {
        const { event_type, data } = event.payload;
        if (event_type === "message" && data) {
          if (isClaude) {
            // For claude-remote, re-fetch all messages (handles both new and updated)
            invoke<RemoteMessage[]>("cr_get_messages", {
              serverUrl,
              token: serverPassword,
            })
              .then((msgs) => setMessages(msgs))
              .catch((err) => console.error("Failed to refresh messages:", err));
          } else if (
            "session_id" in data &&
            data.session_id === session.id &&
            "id" in data &&
            "role" in data
          ) {
            setMessages((prev) => [...prev, data as unknown as RemoteMessage]);
          }
        } else if (event_type === "status" && isClaude && data) {
          if ("status" in data && typeof data.status === "string") {
            setAgentStatus(data.status);
          }
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [session.id, isClaude, serverUrl, serverPassword]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");
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
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, sending, serverUrl, serverPassword, session.id, isClaude]);

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
        <button className="terminal-close" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>

      <div className="message-stream-body">
        {loading && <div className="message-stream-loading">Loading messages...</div>}
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

      <div className="message-stream-input">
        <textarea
          ref={textareaRef}
          className="wt-input message-input-textarea"
          placeholder="Type a message... (Cmd+Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={sending}
          autoFocus
        />
        <button
          className="wt-btn wt-btn-add"
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
