import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RemoteMessage, RemoteSession } from "../types";

interface MessageStreamProps {
  session: RemoteSession;
  serverUrl: string;
  serverPassword: string;
  onClose: () => void;
}

export function MessageStream({ session, serverUrl, serverPassword, onClose }: MessageStreamProps) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load message history
  useEffect(() => {
    setLoading(true);
    invoke<RemoteMessage[]>("oc_get_messages", {
      serverUrl,
      password: serverPassword,
      sessionId: session.id,
    })
      .then((msgs) => {
        setMessages(msgs);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [session.id, serverUrl, serverPassword]);

  // Subscribe to SSE events
  useEffect(() => {
    const unlisten = listen<{ event_type: string; data: Record<string, unknown> }>(
      "oc-event",
      (event) => {
        const { event_type, data } = event.payload;
        if (
          event_type === "message" &&
          data &&
          (data as { session_id?: string }).session_id === session.id
        ) {
          setMessages((prev) => [...prev, data as unknown as RemoteMessage]);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [session.id]);

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
      await invoke("oc_send_message", {
        serverUrl,
        password: serverPassword,
        sessionId: session.id,
        message: text,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, sending, serverUrl, serverPassword, session.id]);

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
        <button className="wt-btn" onClick={onClose} title="Close (Esc)">
          Back
        </button>
        <span className="message-stream-title">{session.title || session.id}</span>
        <span className={`message-stream-status status-${session.status}`}>{session.status}</span>
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
