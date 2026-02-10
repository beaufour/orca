import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session, SessionSummary, AttentionStatus } from "../types";
import { ATTENTION_CONFIG, fallbackAttention, formatTime } from "../utils";
import { useWorktreeActions } from "../hooks/useWorktreeActions";
import { WorktreeActions } from "./WorktreeActions";
import { DiffViewer } from "./DiffViewer";

interface SessionCardProps {
  session: Session;
  groupName?: string;
  isSelected?: boolean;
  isFocused?: boolean;
  onClick?: () => void;
  onSelectSession?: (session: Session) => void;
  confirmingRemove?: boolean;
  onConfirmingRemoveChange?: (confirming: boolean) => void;
  tmuxAlive?: boolean;
  isDismissed?: boolean;
  onDismiss?: () => void;
  onUndismiss?: () => void;
}

function formatPath(path: string): string {
  const home = "/Users/";
  if (path.startsWith(home)) {
    const afterHome = path.slice(home.length);
    const slashIdx = afterHome.indexOf("/");
    if (slashIdx !== -1) {
      return "~" + afterHome.slice(slashIdx);
    }
  }
  return path;
}

export function SessionCard({
  session,
  groupName,
  isSelected,
  isFocused,
  onClick,
  confirmingRemove: confirmingRemoveProp,
  onConfirmingRemoveChange,
  onSelectSession,
  tmuxAlive = true,
  isDismissed,
  onDismiss,
  onUndismiss,
}: SessionCardProps) {
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);
  const [showAddWorktree, setShowAddWorktree] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [branchName, setBranchName] = useState("");

  const repoPath = session.worktree_repo || session.project_path;

  const actions = useWorktreeActions({
    session,
    repoPath,
    onSelectSession,
  });

  // Lift confirmingRemove to parent if prop provided
  const confirmingRemove = confirmingRemoveProp ?? actions.confirmingRemove;
  const setConfirmingRemove = onConfirmingRemoveChange ?? actions.setConfirmingRemove;
  const actionsWithLiftedState = {
    ...actions,
    confirmingRemove,
    setConfirmingRemove,
  };

  // Scroll focused card into view
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);

  const { data: summary } = useQuery<SessionSummary>({
    queryKey: ["summary", session.id],
    queryFn: () =>
      invoke("get_session_summary", {
        projectPath: session.project_path,
        claudeSessionId: session.claude_session_id ?? "",
        agentdeckStatus: session.status,
        tmuxSession: session.tmux_session || null,
      }),
    refetchInterval: 10_000,
    enabled: !!session.claude_session_id,
  });

  const addWorktreeMutation = useMutation({
    mutationFn: async () => {
      const worktreePath = await invoke<string>("add_worktree", {
        repoPath,
        branch: branchName,
      });
      await invoke("update_session_worktree", {
        sessionId: session.id,
        worktreePath,
        worktreeRepo: repoPath,
        worktreeBranch: branchName,
      });
    },
    onSuccess: () => {
      setShowAddWorktree(false);
      setBranchName("");
      queryClient.invalidateQueries({ queryKey: ["worktrees", repoPath] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const attention: AttentionStatus = summary?.attention ?? fallbackAttention(session.status);

  // Auto-undismiss when session is no longer needs_input
  useEffect(() => {
    if (isDismissed && attention !== "needs_input") {
      onUndismiss?.();
    }
  }, [isDismissed, attention, onUndismiss]);

  const effectiveAttention = attention === "needs_input" && isDismissed ? "stale" : attention;
  const statusInfo =
    isDismissed && attention === "needs_input"
      ? { label: "Dismissed", className: "status-dismissed" }
      : ATTENTION_CONFIG[attention];
  const isPending = actions.isPending || addWorktreeMutation.isPending;
  const mutationError = actions.mutationError ?? addWorktreeMutation.error;

  return (
    <div
      ref={cardRef}
      className={`session-card attention-${effectiveAttention}${isSelected ? " session-card-selected" : ""}${isFocused ? " session-card-focused" : ""}`}
      onClick={onClick}
    >
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{session.title}</span>
          {actions.isWorktree ? (
            <span className="wt-badge wt-badge-yes" title={`Worktree: ${session.worktree_branch}`}>
              wt:{session.worktree_branch}
            </span>
          ) : (
            <span
              className="wt-badge wt-badge-no wt-badge-clickable"
              title="Click to create worktree"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddWorktree(true);
              }}
            >
              no wt
            </span>
          )}
        </div>
        <div className="session-badges">
          {!tmuxAlive && (
            <span className="status-badge status-tmux-dead" title="Tmux session not found">
              tmux dead
            </span>
          )}
          <span
            className={`status-badge ${statusInfo.className}${attention === "needs_input" && onDismiss ? " status-badge-clickable" : ""}`}
            onClick={
              attention === "needs_input" && onDismiss
                ? (e) => {
                    e.stopPropagation();
                    onDismiss();
                  }
                : undefined
            }
            title={attention === "needs_input" && !isDismissed ? "Click to dismiss" : undefined}
          >
            {statusInfo.label}
          </span>
        </div>
      </div>
      {showAddWorktree && (
        <div className="wt-add-form" onClick={(e) => e.stopPropagation()}>
          <input
            className="wt-input"
            type="text"
            placeholder="branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && branchName.trim()) {
                addWorktreeMutation.mutate();
              } else if (e.key === "Escape") {
                setShowAddWorktree(false);
                setBranchName("");
              }
            }}
            autoFocus
          />
          <button
            className="wt-btn wt-btn-add"
            onClick={() => addWorktreeMutation.mutate()}
            disabled={!branchName.trim() || isPending}
          >
            Create
          </button>
          <button
            className="wt-btn wt-btn-cancel"
            onClick={() => {
              setShowAddWorktree(false);
              setBranchName("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <div className="session-card-body">
        {(session.prompt || summary?.initial_prompt) && (
          <div className="session-summary">{session.prompt ?? summary?.initial_prompt}</div>
        )}
        <div className="session-path">
          {groupName && <span className="session-group">{groupName}</span>}
          {formatPath(session.project_path)}
        </div>
      </div>
      {mutationError && <div className="session-wt-error">{String(mutationError)}</div>}
      <div className="session-card-footer">
        <WorktreeActions
          actions={actionsWithLiftedState}
          projectPath={session.project_path}
          worktreeBranch={session.worktree_branch}
          onShowDiff={() => setShowDiff(true)}
        />
        <span className="session-time">{formatTime(session.last_accessed)}</span>
      </div>
      {showDiff && <DiffViewer session={session} onClose={() => setShowDiff(false)} />}
    </div>
  );
}
