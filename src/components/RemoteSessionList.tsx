import type { RemoteSession } from "../types";

interface RemoteSessionListProps {
  sessions: RemoteSession[];
  onSelect: (session: RemoteSession) => void;
  onDelete: (id: string) => void;
}

export function RemoteSessionList({ sessions, onSelect, onDelete }: RemoteSessionListProps) {
  if (sessions.length === 0) return null;

  return (
    <div className="remote-session-list">
      {sessions.map((rs) => (
        <div
          key={rs.id}
          className="remote-session-card"
          data-testid={`remote-session-${rs.id}`}
          onClick={() => onSelect(rs)}
        >
          <div className="remote-session-title">{rs.title}</div>
          <div className="remote-session-meta">{new Date(rs.created_at).toLocaleString()}</div>
          <button
            className="wt-btn wt-btn-remove"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(rs.id);
            }}
            title="Remove session"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
