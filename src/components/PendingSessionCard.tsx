import { useState, useEffect } from "react";
import type { PendingCreation } from "../hooks/useSessionCreation";

interface PendingSessionCardProps {
  pending: PendingCreation;
  onDismiss: () => void;
}

const SLOW_THRESHOLD_MS = 5000;

export function PendingSessionCard({ pending, onDismiss }: PendingSessionCardProps) {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (pending.error) return;
    const check = () => {
      const elapsed = Date.now() - pending.startedAt;
      if (elapsed >= SLOW_THRESHOLD_MS) {
        setIsSlow(true);
      } else {
        const timer = setTimeout(() => setIsSlow(true), SLOW_THRESHOLD_MS - elapsed);
        return timer;
      }
    };
    const timer = check();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pending.startedAt, pending.error]);

  return (
    <div className="session-card session-card-creating">
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{pending.title}</span>
          {pending.branch && <span className="wt-badge wt-badge-yes">{pending.branch}</span>}
        </div>
      </div>
      <div className="session-card-body">
        {pending.error ? (
          <div className="session-creating-error">
            <span>{pending.error}</span>
            <button className="wt-btn wt-btn-cancel" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        ) : (
          <div className="session-summary session-ghost-hint">
            <span className="spinner" /> Creating session...
            {isSlow && <div className="session-creating-slow">This is taking a while...</div>}
          </div>
        )}
      </div>
    </div>
  );
}
