import { useState } from "react";
import type { Session, RemoteSession } from "../types";
import type { PendingCreation, CreateSessionParams } from "../hooks/useSessionCreation";
import { isMainSession } from "../utils";
import { SessionCard } from "./SessionCard";
import { MainSessionGhost } from "./MainSessionGhost";
import { PendingSessionCard } from "./PendingSessionCard";
import { RemoteSessionCard } from "./RemoteSessionCard";

interface SessionListProps {
  sessions: Session[] | undefined;
  groupNames?: Record<string, string>;
  onSelectSession: (session: Session) => void;
  selectedSessionId: string | null;
  focusedSessionId?: string | null;
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
  remoteSession?: RemoteSession | null;
  remoteServerUrl?: string;
  remoteToken?: string;
  remoteInitialPrompt?: string | null;
  onReconnectRemote?: () => void;
  onRemoveRemote?: () => void;
}

function renderSessionCard(
  session: Session,
  props: {
    groupNames?: Record<string, string>;
    selectedSessionId: string | null;
    focusedSessionId: string | null;
    onSelectSession: (session: Session) => void;
    confirmingRemoveId?: string | null;
    onConfirmingRemoveChange?: (sessionId: string | null) => void;
    liveTmuxSessions?: Set<string>;
    dismissedIds?: Set<string>;
    onDismiss?: (sessionId: string) => void;
    onUndismiss?: (sessionId: string) => void;
    mergeWorkflow?: "merge" | "pr";
  },
) {
  return (
    <SessionCard
      key={session.id}
      session={session}
      groupName={props.groupNames?.[session.group_path]}
      isSelected={session.id === props.selectedSessionId}
      isFocused={session.id === props.focusedSessionId}
      onClick={() => props.onSelectSession(session)}
      onSelectSession={props.onSelectSession}
      confirmingRemove={
        props.confirmingRemoveId != null ? session.id === props.confirmingRemoveId : undefined
      }
      onConfirmingRemoveChange={
        props.onConfirmingRemoveChange
          ? (c) => props.onConfirmingRemoveChange!(c ? session.id : null)
          : undefined
      }
      tmuxAlive={
        !session.tmux_session || props.liveTmuxSessions?.has(session.tmux_session) !== false
      }
      isDismissed={props.dismissedIds?.has(session.id)}
      onDismiss={props.onDismiss ? () => props.onDismiss!(session.id) : undefined}
      onUndismiss={props.onUndismiss ? () => props.onUndismiss!(session.id) : undefined}
      mergeWorkflow={props.mergeWorkflow}
    />
  );
}

export function SessionList({
  sessions,
  groupNames,
  onSelectSession,
  selectedSessionId,
  focusedSessionId = null,
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
  remoteSession,
  remoteServerUrl,
  remoteToken,
  remoteInitialPrompt,
  onReconnectRemote,
  onRemoveRemote,
}: SessionListProps) {
  const [dismissedExpanded, setDismissedExpanded] = useState(false);

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

  if (sessions.length === 0 && groupPending.length === 0 && !remoteSession) {
    return <div className="session-list-empty">No sessions found</div>;
  }

  const hasMainSession = sessions.some((s) => isMainSession(s.worktree_branch));
  const showGhost = groupPath && repoPath && !hasMainSession;

  // Split sessions: main always active, rest split by dismissed status
  const activeSessions: Session[] = [];
  const dismissedSessions: Session[] = [];
  for (const s of sessions) {
    if (isMainSession(s.worktree_branch) || !dismissedIds?.has(s.id)) {
      activeSessions.push(s);
    } else {
      dismissedSessions.push(s);
    }
  }

  const cardProps = {
    groupNames,
    selectedSessionId,
    focusedSessionId,
    onSelectSession,
    confirmingRemoveId,
    onConfirmingRemoveChange,
    liveTmuxSessions,
    dismissedIds,
    onDismiss,
    onUndismiss,
    mergeWorkflow,
  };

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
        {activeSessions.map((session) => renderSessionCard(session, cardProps))}
        {remoteSession && onReconnectRemote && onRemoveRemote && remoteServerUrl && (
          <RemoteSessionCard
            session={remoteSession}
            serverUrl={remoteServerUrl}
            token={remoteToken ?? ""}
            initialPrompt={remoteInitialPrompt}
            onClick={onReconnectRemote}
            onRemove={onRemoveRemote}
          />
        )}
        {groupPending.map((pending) => (
          <PendingSessionCard
            key={pending.creationId}
            pending={pending}
            onDismiss={() => onDismissPending?.(pending.creationId)}
          />
        ))}
      </div>
      {dismissedSessions.length > 0 && (
        <div className="dismissed-section">
          <button
            className="dismissed-section-header"
            onClick={() => setDismissedExpanded((v) => !v)}
          >
            <span className="dismissed-section-chevron">
              {dismissedExpanded ? "\u25BE" : "\u25B8"}
            </span>
            <span>Dismissed</span>
            <span className="dismissed-section-count">{dismissedSessions.length}</span>
          </button>
          {dismissedExpanded && (
            <div className="session-grid">
              {dismissedSessions.map((session) => renderSessionCard(session, cardProps))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
