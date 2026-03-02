import { useState } from "react";
import type { Session } from "../types";
import type { PendingCreation, CreateSessionParams } from "../hooks/useSessionCreation";
import { isMainSession } from "../utils";
import { SessionCard } from "./SessionCard";
import { MainSessionGhost } from "./MainSessionGhost";
import { PendingSessionCard } from "./PendingSessionCard";

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

function renderSessionCard(
  session: Session,
  props: {
    groupNames?: Record<string, string>;
    selectedSessionId: string | null;
    focusedIndex: number;
    sessionIndex: number;
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
      isFocused={props.sessionIndex === props.focusedIndex}
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

  if (sessions.length === 0 && groupPending.length === 0) {
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

  // Build index map: each session's position in the original flat list for focusedIndex
  const indexMap = new Map<string, number>();
  sessions.forEach((s, i) => indexMap.set(s.id, i));

  const cardProps = {
    groupNames,
    selectedSessionId,
    focusedIndex,
    sessionIndex: -1,
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
        {activeSessions.map((session) =>
          renderSessionCard(session, {
            ...cardProps,
            sessionIndex: indexMap.get(session.id) ?? -1,
          }),
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
              {dismissedSessions.map((session) =>
                renderSessionCard(session, {
                  ...cardProps,
                  sessionIndex: indexMap.get(session.id) ?? -1,
                }),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
