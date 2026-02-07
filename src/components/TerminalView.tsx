import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";

interface TerminalViewProps {
  session: Session;
  onClose: () => void;
}

export function TerminalView({ session, onClose }: TerminalViewProps) {
  const [input, setInput] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const prevOutputRef = useRef<string>("");

  const { data: output } = useQuery<string>({
    queryKey: ["terminal", session.tmux_session],
    queryFn: () => invoke("capture_pane", { tmuxSession: session.tmux_session }),
    refetchInterval: 1_000,
    enabled: !!session.tmux_session,
  });

  const sendMutation = useMutation({
    mutationFn: (keys: string) =>
      invoke("send_keys", { tmuxSession: session.tmux_session, keys }),
  });

  // Auto-scroll when output changes
  useEffect(() => {
    if (output && output !== prevOutputRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
      prevOutputRef.current = output;
    }
  }, [output]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMutation.mutate(input);
      setInput("");
    }
  };

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
        <button className="terminal-close" onClick={onClose}>
          Close
        </button>
      </div>
      <pre className="terminal-output" ref={outputRef}>
        {output ?? "Loading..."}
      </pre>
      <form className="terminal-input-row" onSubmit={handleSubmit}>
        <input
          className="terminal-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type and press Enter to send..."
          autoFocus
        />
        <button className="wt-btn wt-btn-confirm" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}
