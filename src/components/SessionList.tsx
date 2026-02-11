import type { Session } from "../types";
import type { PendingCreation } from "../hooks/useSessionCreation";
import { SessionCard } from "./SessionCard";
import { MainSessionGhost } from "./MainSessionGhost";
import { PendingSessionCard } from "./PendingSessionCard";

interface CreateSessionParams {
  projectPath: string;
  group: string;
  title: string;
  tool?: string;
  worktreeBranch?: string | null;
  newBranch?: boolean;
  start?: boolean;
  prompt?: string | null;
}

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
  groupPath?: string;
  repoPath?: string;
  liveTmuxSessions?: Set<string>;
  dismissedIds?: Set<string>;
  onDismiss?: (sessionId: string) => void;
  onUndismiss?: (sessionId: string) => void;
  pendingCreations?: Map<string, PendingCreation>;
  onDismissPending?: (creationId: string) => void;
  createSession?: (params: CreateSessionParams) => void;
  mergeWorkflow?: "merge" | "pr";
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
  groupPath,
  repoPath,
  liveTmuxSessions,
  dismissedIds,
  onDismiss,
  onUndismiss,
  pendingCreations,
  onDismissPending,
  createSession,
  mergeWorkflow,
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

  // Filter pending creations to current group (needed before empty check)
  const groupPending = pendingCreations
    ? Array.from(pendingCreations.values()).filter((p) => !groupPath || p.groupPath === groupPath)
    : [];

  if (sessions.length === 0 && groupPending.length === 0) {
    return <div className="session-list-empty">No sessions found</div>;
  }

  const hasMainSession = sessions.some(
    (s) => !s.worktree_branch || s.worktree_branch === "main" || s.worktree_branch === "master",
  );

  const showGhost = groupPath && repoPath && !hasMainSession;

  return (
    <div className="session-list">
      <div className="session-grid">
        {showGhost && (
          <MainSessionGhost
            repoPath={repoPath}
            groupPath={groupPath}
            createSession={createSession}
          />
        )}
        {sessions.map((session, index) => (
          <SessionCard
            key={session.id}
            session={session}
            groupName={groupNames?.[session.group_path]}
            isSelected={session.id === selectedSessionId}
            isFocused={index === focusedIndex}
            onClick={() => onSelectSession(session)}
            onSelectSession={onSelectSession}
            confirmingRemove={
              confirmingRemoveId != null ? session.id === confirmingRemoveId : undefined
            }
            onConfirmingRemoveChange={
              onConfirmingRemoveChange
                ? (c) => onConfirmingRemoveChange(c ? session.id : null)
                : undefined
            }
            tmuxAlive={
              !session.tmux_session || liveTmuxSessions?.has(session.tmux_session) !== false
            }
            isDismissed={dismissedIds?.has(session.id)}
            onDismiss={onDismiss ? () => onDismiss(session.id) : undefined}
            onUndismiss={onUndismiss ? () => onUndismiss(session.id) : undefined}
            mergeWorkflow={mergeWorkflow}
          />
        ))}
        {groupPending.map((pending) => (
          <PendingSessionCard
            key={pending.creationId}
            pending={pending}
            onDismiss={() => onDismissPending?.(pending.creationId)}
          />
        ))}
      </div>
    </div>
  );
}
