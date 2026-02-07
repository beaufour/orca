import type { Session } from "../types";
import { SessionCard } from "./SessionCard";

interface SessionListProps {
  sessions: Session[] | undefined;
  groupNames?: Record<string, string>;
  onSelectSession: (session: Session) => void;
  selectedSessionId: string | null;
  focusedIndex?: number;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  confirmingRemoveId?: string | null;
  onConfirmingRemoveChange?: (sessionId: string | null) => void;
}

export function SessionList({
  sessions,
  groupNames,
  onSelectSession,
  selectedSessionId,
  focusedIndex = -1,
  isLoading,
  error,
  onRetry,
  confirmingRemoveId,
  onConfirmingRemoveChange,
}: SessionListProps) {
  if (error) {
    return (
      <div className="session-list-empty">
        <div className="error-row">
          Failed to load sessions: {error.message || String(error)}
          {onRetry && (
            <button className="retry-btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!sessions || isLoading) {
    return (
      <div className="session-list-empty">
        <div className="loading-row">
          <span className="spinner" /> Loading sessions...
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div className="session-list-empty">No sessions found</div>;
  }

  return (
    <div className="session-list">
      <div className="session-grid">
        {sessions.map((session, index) => (
          <SessionCard
            key={session.id}
            session={session}
            groupName={groupNames?.[session.group_path]}
            isSelected={session.id === selectedSessionId}
            isFocused={index === focusedIndex}
            onClick={() => onSelectSession(session)}
            confirmingRemove={confirmingRemoveId != null ? session.id === confirmingRemoveId : undefined}
            onConfirmingRemoveChange={onConfirmingRemoveChange ? (c) => onConfirmingRemoveChange(c ? session.id : null) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
