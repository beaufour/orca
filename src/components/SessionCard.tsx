import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  Session,
  SessionSummary,
  AttentionStatus,
  WorktreeStatus,
  MergeResult,
} from "../types";
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

const ATTENTION_CONFIG: Record<AttentionStatus, { label: string; className: string }> = {
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
  if (epoch <= 0) return "never";
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
  onSelectSession,
  tmuxAlive = true,
  isDismissed,
  onDismiss,
  onUndismiss,
}: SessionCardProps) {
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);
  const [confirmingRemoveInternal, setConfirmingRemoveInternal] = useState(false);
  const confirmingRemove = confirmingRemoveProp ?? confirmingRemoveInternal;
  const setConfirmingRemove = onConfirmingRemoveChange ?? setConfirmingRemoveInternal;
  const [showAddWorktree, setShowAddWorktree] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [mergeState, setMergeState] = useState<
    "idle" | "confirming" | "merging" | "success" | "conflict"
  >("idle");
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

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
        tmuxSession: session.tmux_session || null,
      }),
    refetchInterval: 10_000,
    enabled: !!session.claude_session_id,
  });

  const { data: worktreeStatus, isLoading: statusLoading } = useQuery<WorktreeStatus>({
    queryKey: ["worktreeStatus", session.worktree_path],
    queryFn: () =>
      invoke("check_worktree_status", {
        repoPath: repoPath,
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
    enabled: (confirmingRemove || mergeState === "confirming") && isWorktree,
    staleTime: 5_000,
  });

  // For merge, only dirty files matter (unmerged/unpushed are expected — that's why you're merging)
  const mergeWarnings = worktreeStatus?.has_dirty_files
    ? worktreeStatus.warnings.filter((w) => w.includes("uncommitted"))
    : [];
  const hasWarnings = !!worktreeStatus?.warnings.length;
  const hasMergeWarnings = mergeWarnings.length > 0;

  const invalidateWorktrees = () => {
    queryClient.invalidateQueries({ queryKey: ["worktrees", repoPath] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

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

  const { data: defaultBranch } = useQuery<string>({
    queryKey: ["defaultBranch", repoPath],
    queryFn: () => invoke("get_default_branch", { repoPath }),
    staleTime: 5 * 60 * 1000,
    enabled: isWorktree,
  });

  const isFeatureBranch =
    isWorktree &&
    session.worktree_branch !== "main" &&
    session.worktree_branch !== "master" &&
    session.worktree_branch !== defaultBranch;

  const mergeMutation = useMutation({
    mutationFn: () =>
      invoke<MergeResult>("try_merge_branch", {
        repoPath,
        branch: session.worktree_branch,
        mainBranch: defaultBranch ?? "main",
      }),
    onSuccess: (result) => {
      setMergeResult(result);
      setMergeState(result.success ? "success" : "conflict");
    },
    onError: () => {
      setMergeState("idle");
    },
  });

  const mergeCleanupMutation = useMutation({
    mutationFn: async (mode: "remove_all" | "remove_worktree" | "keep") => {
      if (mode === "remove_all") {
        try {
          await invoke("remove_worktree", {
            repoPath,
            worktreePath: session.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
        await invoke("remove_session", { sessionId: session.id });
      } else if (mode === "remove_worktree") {
        try {
          await invoke("remove_worktree", {
            repoPath,
            worktreePath: session.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
        await invoke("clear_session_worktree", { sessionId: session.id });
      }
      // mode === "keep" — do nothing
    },
    onSuccess: () => {
      setMergeState("idle");
      setMergeResult(null);
      invalidateWorktrees();
    },
  });

  const conflictSessionMutation = useMutation({
    mutationFn: async () => {
      const mainPath = mergeResult?.main_worktree_path;
      if (!mainPath) throw new Error("No main worktree path");
      const prompt = `There are merge conflicts from merging '${session.worktree_branch}' into ${defaultBranch ?? "main"}. Please resolve all conflicts, then commit the merge.`;
      const sessionId = await invoke<string>("create_session", {
        projectPath: mainPath,
        group: session.group_path,
        title: `merge-${session.worktree_branch}`,
        tool: "claude",
        worktreeBranch: null,
        newBranch: false,
        start: true,
        prompt,
      });
      return sessionId;
    },
    onSuccess: async (sessionId) => {
      setMergeState("idle");
      setMergeResult(null);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (onSelectSession) {
        const sessions = await invoke<Session[]>("get_sessions", {
          groupPath: session.group_path,
        });
        const created = sessions.find((s) => s.id === sessionId);
        if (created) onSelectSession(created);
      }
    },
  });

  const abortMergeMutation = useMutation({
    mutationFn: () => {
      const mainPath = mergeResult?.main_worktree_path;
      if (!mainPath) throw new Error("No main worktree path");
      return invoke("abort_merge", { worktreePath: mainPath });
    },
    onSuccess: () => {
      setMergeState("idle");
      setMergeResult(null);
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
  const isPending =
    removeMutation.isPending ||
    addWorktreeMutation.isPending ||
    mergeMutation.isPending ||
    mergeCleanupMutation.isPending ||
    conflictSessionMutation.isPending ||
    abortMergeMutation.isPending;
  const mutationError =
    removeMutation.error ??
    addWorktreeMutation.error ??
    mergeMutation.error ??
    mergeCleanupMutation.error ??
    conflictSessionMutation.error ??
    abortMergeMutation.error;

  return (
    <div
      ref={cardRef}
      className={`session-card attention-${effectiveAttention}${isSelected ? " session-card-selected" : ""}${isFocused ? " session-card-focused" : ""}`}
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
        {summary?.summary && <div className="session-summary">{summary.summary}</div>}
        {!summary?.summary && summary?.last_text && (
          <div className="session-summary session-last-text">{summary.last_text}</div>
        )}
        <div className="session-path">
          {groupName && <span className="session-group">{groupName}</span>}
          {formatPath(session.project_path)}
        </div>
      </div>
      {mutationError && <div className="session-wt-error">{String(mutationError)}</div>}
      <div className="session-card-footer">
        <div className="session-wt-actions">
          {mergeState === "idle" && (
            <button
              className="wt-btn wt-btn-action"
              onClick={(e) => {
                e.stopPropagation();
                invoke("open_in_terminal", { path: session.project_path });
              }}
              disabled={isPending}
              title={`Open iTerm in ${session.project_path}`}
            >
              Term
            </button>
          )}
          {isWorktree && mergeState === "idle" && (
            <>
              <button
                className="wt-btn wt-btn-action"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDiff(true);
                }}
                disabled={isPending}
                title="Show diff vs main"
              >
                Diff
              </button>
              {isFeatureBranch && (
                <button
                  className="wt-btn wt-btn-merge"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMergeState("confirming");
                  }}
                  disabled={isPending}
                  title={`Merge ${session.worktree_branch} into ${defaultBranch ?? "main"}`}
                >
                  Merge
                </button>
              )}
            </>
          )}
          {mergeState === "confirming" && (
            <>
              {statusLoading && (
                <span className="loading-row">
                  <span className="spinner" />
                </span>
              )}
              {hasMergeWarnings && (
                <div className="remove-warnings">
                  {mergeWarnings.map((w, i) => (
                    <span key={i} className="remove-warning-item">
                      {w}
                    </span>
                  ))}
                </div>
              )}
              <span className="merge-label">Merge into {defaultBranch ?? "main"}?</span>
              <button
                className="wt-btn wt-btn-merge"
                onClick={(e) => {
                  e.stopPropagation();
                  setMergeState("merging");
                  mergeMutation.mutate();
                }}
                disabled={isPending || statusLoading}
              >
                {hasMergeWarnings ? "Merge Anyway" : "Confirm"}
              </button>
              <button
                className="wt-btn wt-btn-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setMergeState("idle");
                }}
              >
                Cancel
              </button>
            </>
          )}
          {mergeState === "merging" && (
            <span className="loading-row">
              <span className="spinner" /> Merging...
            </span>
          )}
          {mergeState === "success" && (
            <div className="merge-cleanup">
              <span className="merge-success-label">Merged!</span>
              <button
                className="wt-btn wt-btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  mergeCleanupMutation.mutate("remove_all");
                }}
                disabled={isPending}
              >
                Remove All
              </button>
              <button
                className="wt-btn wt-btn-action"
                onClick={(e) => {
                  e.stopPropagation();
                  mergeCleanupMutation.mutate("remove_worktree");
                }}
                disabled={isPending}
              >
                Remove Worktree
              </button>
              <button
                className="wt-btn wt-btn-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  mergeCleanupMutation.mutate("keep");
                }}
              >
                Keep
              </button>
            </div>
          )}
          {mergeState === "conflict" && (
            <div className="merge-conflict">
              <span className="merge-conflict-label">Conflict</span>
              <button
                className="wt-btn wt-btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  abortMergeMutation.mutate();
                }}
                disabled={isPending}
              >
                Abort
              </button>
              <button
                className="wt-btn wt-btn-merge"
                onClick={(e) => {
                  e.stopPropagation();
                  conflictSessionMutation.mutate();
                }}
                disabled={isPending}
              >
                Resolve with Claude
              </button>
            </div>
          )}
          {mergeState === "idle" && !confirmingRemove && (
            <button
              className="wt-btn wt-btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingRemove(true);
              }}
              disabled={isPending}
              title={isWorktree ? "Remove worktree and session" : "Remove session"}
            >
              Remove
            </button>
          )}
          {confirmingRemove && mergeState === "idle" && (
            <>
              {isWorktree && statusLoading && (
                <span className="loading-row">
                  <span className="spinner" />
                </span>
              )}
              {isWorktree && worktreeStatus && hasWarnings && (
                <div className="remove-warnings">
                  {worktreeStatus.warnings.map((w, i) => (
                    <span key={i} className="remove-warning-item">
                      {w}
                    </span>
                  ))}
                </div>
              )}
              <button
                className="wt-btn wt-btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  removeMutation.mutate();
                }}
                disabled={isPending || (isWorktree && statusLoading)}
              >
                {hasWarnings ? "Force Remove" : "Confirm"}
              </button>
              <button
                className="wt-btn wt-btn-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingRemove(false);
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
        <span className="session-time">{formatTime(session.last_accessed)}</span>
      </div>
      {showDiff && <DiffViewer session={session} onClose={() => setShowDiff(false)} />}
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
