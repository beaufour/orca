import type { Session } from "../types";
import { SessionCard } from "./SessionCard";

interface SessionListProps {
  sessions: Session[] | undefined;
  onSelectSession: (session: Session) => void;
  selectedSessionId: string | null;
  focusedIndex?: number;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export function SessionList({
  sessions,
  onSelectSession,
  selectedSessionId,
  focusedIndex = -1,
  isLoading,
  error,
  onRetry,
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
            isSelected={session.id === selectedSessionId}
            isFocused={index === focusedIndex}
            onClick={() => onSelectSession(session)}
          />
        ))}
      </div>
    </div>
  );
}
