import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { Modal } from "./Modal";

interface LogViewerProps {
  onClose: () => void;
}

export function LogViewer({ onClose }: LogViewerProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const {
    data: logText,
    error,
    isFetching: loading,
    refetch,
  } = useQuery({
    queryKey: ["app-log"],
    queryFn: () => invoke<string>("read_app_log"),
  });
  const fetchLog = () => {
    void refetch();
  };

  useEffect(() => {
    if (logText && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logText]);

  useEscapeKey(onClose);

  return (
    <Modal onClose={onClose} className="diff-modal-content">
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
        {error && <div className="error-row">{String(error)}</div>}
        {logText !== undefined && <pre className="log-viewer-content">{logText}</pre>}
        {logText !== undefined && logText.length === 0 && !loading && (
          <div className="diff-empty">No log entries</div>
        )}
      </div>
    </Modal>
  );
}
