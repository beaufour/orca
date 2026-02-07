import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session, SessionSummary, AttentionStatus } from "../types";

interface SessionCardProps {
  session: Session;
  groupName?: string;
  isSelected?: boolean;
  isFocused?: boolean;
  onClick?: () => void;
  confirmingRemove?: boolean;
  onConfirmingRemoveChange?: (confirming: boolean) => void;
}

const ATTENTION_CONFIG: Record<
  AttentionStatus,
  { label: string; className: string }
> = {
  needs_input: { label: "Needs Input", className: "status-needs-input" },
  error: { label: "Error", className: "status-error" },
  running: { label: "Running", className: "status-running" },
  idle: { label: "Idle", className: "status-idle" },
  stale: { label: "Stale", className: "status-stale" },
  unknown: { label: "Unknown", className: "status-stale" },
};

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

function formatTime(epoch: number): string {
  if (epoch === 0) return "never";
  const date = new Date(epoch * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function SessionCard({
  session,
  groupName,
  isSelected,
  isFocused,
  onClick,
  confirmingRemove: confirmingRemoveProp,
  onConfirmingRemoveChange,
}: SessionCardProps) {
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);
  const [confirmingRemoveInternal, setConfirmingRemoveInternal] = useState(false);
  const confirmingRemove = confirmingRemoveProp ?? confirmingRemoveInternal;
  const setConfirmingRemove = onConfirmingRemoveChange ?? setConfirmingRemoveInternal;
  const [showAddWorktree, setShowAddWorktree] = useState(false);
  const [branchName, setBranchName] = useState("");

  // Scroll focused card into view
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);
  const isWorktree = !!session.worktree_branch;
  const repoPath = session.worktree_repo || session.project_path;

  const { data: summary } = useQuery<SessionSummary>({
    queryKey: ["summary", session.id],
    queryFn: () =>
      invoke("get_session_summary", {
        projectPath: session.project_path,
        claudeSessionId: session.claude_session_id ?? "",
        agentdeckStatus: session.status,
      }),
    refetchInterval: 10_000,
    enabled: !!session.claude_session_id,
  });

  const invalidateWorktrees = () => {
    queryClient.invalidateQueries({ queryKey: ["worktrees", repoPath] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const rebaseMutation = useMutation({
    mutationFn: () =>
      invoke("rebase_worktree", {
        worktreePath: session.worktree_path,
        mainBranch: null,
      }),
    onSuccess: invalidateWorktrees,
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      invoke("merge_worktree", {
        repoPath,
        branch: session.worktree_branch,
        mainBranch: null,
      }),
    onSuccess: invalidateWorktrees,
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (isWorktree) {
        try {
          await invoke("remove_worktree", {
            repoPath,
            worktreePath: session.worktree_path,
          });
        } catch {
          // Worktree may already be gone — continue with session removal
        }
      }
      await invoke("remove_session", { sessionId: session.id });
    },
    onSuccess: () => {
      setConfirmingRemove(false);
      invalidateWorktrees();
    },
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
      invalidateWorktrees();
    },
  });

  const attention: AttentionStatus =
    summary?.attention ?? fallbackAttention(session.status);
  const statusInfo = ATTENTION_CONFIG[attention];
  const isPending =
    rebaseMutation.isPending ||
    mergeMutation.isPending ||
    removeMutation.isPending ||
    addWorktreeMutation.isPending;
  const mutationError =
    rebaseMutation.error ?? mergeMutation.error ?? removeMutation.error ?? addWorktreeMutation.error;

  return (
    <div
      ref={cardRef}
      className={`session-card attention-${attention}${isSelected ? " session-card-selected" : ""}${isFocused ? " session-card-focused" : ""}`}
      onClick={onClick}
    >
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{session.title}</span>
          {isWorktree ? (
            <span className="wt-badge wt-badge-yes" title={`Worktree: ${session.worktree_branch}`}>
              wt:{session.worktree_branch}
            </span>
          ) : (
            <span
              className="wt-badge wt-badge-no wt-badge-clickable"
              title="Click to create worktree"
              onClick={(e) => { e.stopPropagation(); setShowAddWorktree(true); }}
            >
              no wt
            </span>
          )}
        </div>
        <span className={`status-badge ${statusInfo.className}`}>
          {statusInfo.label}
        </span>
      </div>
      {showAddWorktree && (
        <div className="wt-add-form" onClick={(e) => e.stopPropagation()}>
          <input
            className="wt-input"
            type="text"
            placeholder="branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
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
            onClick={() => { setShowAddWorktree(false); setBranchName(""); }}
          >
            Cancel
          </button>
        </div>
      )}
      <div className="session-card-body">
        {summary?.summary && (
          <div className="session-summary">{summary.summary}</div>
        )}
        {!summary?.summary && summary?.last_text && (
          <div className="session-summary session-last-text">
            {summary.last_text}
          </div>
        )}
        <div className="session-path">
          {groupName && <span className="session-group">{groupName}</span>}
          {formatPath(session.project_path)}
        </div>
      </div>
      {mutationError && (
        <div className="session-wt-error">{String(mutationError)}</div>
      )}
      <div className="session-card-footer">
        <div className="session-wt-actions">
          {isWorktree && (
            <>
              <button
                className="wt-btn wt-btn-action"
                onClick={(e) => { e.stopPropagation(); rebaseMutation.mutate(); }}
                disabled={isPending}
                title="Rebase on main"
              >
                Rebase
              </button>
              <button
                className="wt-btn wt-btn-action"
                onClick={(e) => { e.stopPropagation(); mergeMutation.mutate(); }}
                disabled={isPending}
                title="Merge into main and remove"
              >
                Merge
              </button>
            </>
          )}
          {confirmingRemove ? (
            <>
              <button
                className="wt-btn wt-btn-danger"
                onClick={(e) => { e.stopPropagation(); removeMutation.mutate(); }}
                disabled={isPending}
              >
                Confirm
              </button>
              <button
                className="wt-btn wt-btn-cancel"
                onClick={(e) => { e.stopPropagation(); setConfirmingRemove(false); }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="wt-btn wt-btn-danger"
              onClick={(e) => { e.stopPropagation(); setConfirmingRemove(true); }}
              disabled={isPending}
              title={isWorktree ? "Remove worktree and session" : "Remove session"}
            >
              Remove
            </button>
          )}
        </div>
        <span className="session-time">
          {formatTime(session.last_accessed)}
        </span>
      </div>
    </div>
  );
}

function fallbackAttention(agentdeckStatus: string): AttentionStatus {
  switch (agentdeckStatus) {
    case "running":
      return "running";
    case "waiting":
      return "needs_input";
    case "error":
      return "error";
    case "idle":
      return "idle";
    default:
      return "unknown";
  }
}
