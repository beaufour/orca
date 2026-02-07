import type { Session } from "../types";
import { SessionCard } from "./SessionCard";

interface SessionListProps {
  sessions: Session[] | undefined;
  onSelectSession: (session: Session) => void;
  selectedSessionId: string | null;
}

export function SessionList({
  sessions,
  onSelectSession,
  selectedSessionId,
}: SessionListProps) {
  if (!sessions) {
    return <div className="session-list-empty">Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <div className="session-list-empty">No sessions found</div>;
  }

  return (
    <div className="session-list">
      <div className="session-grid">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isSelected={session.id === selectedSessionId}
            onClick={() => onSelectSession(session)}
          />
        ))}
      </div>
    </div>
  );
}
