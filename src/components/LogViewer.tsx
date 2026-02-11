import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface LogViewerProps {
  onClose: () => void;
}

export function LogViewer({ onClose }: LogViewerProps) {
  const [logText, setLogText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await invoke<string>("read_app_log");
      setLogText(text);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (logText && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logText]);

  useEscapeKey(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="diff-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="log-viewer-header">
          <span className="diff-header-title">App Log</span>
          <div className="log-viewer-actions">
            <button className="wt-btn" onClick={fetchLog} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button className="wt-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="log-viewer-body" ref={bodyRef}>
          {error && <div className="error-row">{error}</div>}
          {logText !== null && <pre className="log-viewer-content">{logText}</pre>}
          {logText !== null && logText.length === 0 && !loading && (
            <div className="diff-empty">No log entries</div>
          )}
        </div>
      </div>
    </div>
  );
}
