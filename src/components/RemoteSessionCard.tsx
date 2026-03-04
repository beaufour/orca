import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { RemoteSession } from "../types";
import type { AttentionStatus } from "../types";
import { ATTENTION_CONFIG, formatTime } from "../utils";

interface RemoteSessionCardProps {
  session: RemoteSession;
  serverUrl: string;
  token: string;
  initialPrompt?: string | null;
  onClick: () => void;
  onRemove: () => void;
}

/** Map AgentAPI status to our attention status. */
function mapAgentStatus(agentStatus: string): AttentionStatus {
  switch (agentStatus) {
    case "running":
      return "running";
    case "stable":
      return "idle";
    default:
      return "unknown";
  }
}

export function RemoteSessionCard({
  session,
  serverUrl,
  token,
  initialPrompt,
  onClick,
  onRemove,
}: RemoteSessionCardProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const { data: statusData } = useQuery<{ status: string }>({
    queryKey: ["cr-status", serverUrl],
    queryFn: () => invoke("cr_get_status", { serverUrl, token }),
    refetchInterval: 5_000,
  });

  const attention = statusData ? mapAgentStatus(statusData.status) : "unknown";
  const statusInfo = ATTENTION_CONFIG[attention];
  // created_at is Date.now() (ms), formatTime expects seconds
  const epochSeconds = Math.floor(session.created_at / 1000);

  return (
    <div className={`session-card attention-${attention}`} onClick={onClick}>
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{session.title || session.id}</span>
          <span className="wt-badge wt-badge-yes">remote</span>
        </div>
        <div className="session-badges">
          <span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span>
        </div>
      </div>
      <div className="session-card-body">
        {initialPrompt && <div className="session-summary">{initialPrompt}</div>}
      </div>
      <div className="session-card-footer">
        <div className="wt-actions" onClick={(e) => e.stopPropagation()}>
          {confirmingRemove ? (
            <>
              <button className="wt-btn wt-btn-remove" onClick={onRemove}>
                Confirm
              </button>
              <button className="wt-btn wt-btn-cancel" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="wt-btn wt-btn-remove" onClick={() => setConfirmingRemove(true)}>
              Remove
            </button>
          )}
        </div>
        <span className="session-time">{formatTime(epochSeconds)}</span>
      </div>
    </div>
  );
}
