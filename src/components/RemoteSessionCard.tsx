import type { RemoteSession } from "../types";

interface RemoteSessionCardProps {
  session: RemoteSession;
  onClick: () => void;
}

export function RemoteSessionCard({ session, onClick }: RemoteSessionCardProps) {
  return (
    <div className="session-card attention-running" onClick={onClick}>
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{session.title || session.id}</span>
        </div>
        <div className="session-badges">
          <span className="status-badge status-running">remote</span>
        </div>
      </div>
      <div className="session-card-body">
        <div className="session-summary">Click to reconnect</div>
      </div>
    </div>
  );
}
