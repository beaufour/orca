import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  GitHubIssue,
  Session,
  SessionSummary,
  AttentionStatus,
  WorktreeStatus,
  MergeResult,
} from "../types";
import { DiffViewer } from "./DiffViewer";

interface TodoCardProps {
  issue: GitHubIssue;
  session?: Session;
  repoPath: string;
  onSelectSession?: (session: Session) => void;
  onStartIssue?: (issue: GitHubIssue) => void;
  onEditIssue?: (issue: GitHubIssue) => void;
  liveTmuxSessions?: Set<string>;
}

const ATTENTION_CONFIG: Record<AttentionStatus, { label: string; className: string }> = {
  needs_input: { label: "Needs Input", className: "status-needs-input" },
  error: { label: "Error", className: "status-error" },
  running: { label: "Running", className: "status-running" },
  idle: { label: "Idle", className: "status-idle" },
  stale: { label: "Stale", className: "status-stale" },
  unknown: { label: "Unknown", className: "status-stale" },
};

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

function labelStyle(color: string): React.CSSProperties {
  // color is hex without '#'
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.2)`,
    color: `#${color}`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
  };
}

export function TodoCard({
  issue,
  session,
  repoPath,
  onSelectSession,
  onStartIssue,
  onEditIssue,
  liveTmuxSessions,
}: TodoCardProps) {
  const queryClient = useQueryClient();
  const [showDiff, setShowDiff] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [mergeState, setMergeState] = useState<
    "idle" | "confirming" | "merging" | "success" | "conflict"
  >("idle");
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

  const { data: summary } = useQuery<SessionSummary>({
    queryKey: ["summary", session?.id],
    queryFn: () =>
      invoke("get_session_summary", {
        projectPath: session!.project_path,
        claudeSessionId: session!.claude_session_id ?? "",
        agentdeckStatus: session!.status,
        tmuxSession: session!.tmux_session || null,
      }),
    refetchInterval: 10_000,
    enabled: !!session?.claude_session_id,
  });

  const { data: defaultBranch } = useQuery<string>({
    queryKey: ["defaultBranch", repoPath],
    queryFn: () => invoke("get_default_branch", { repoPath }),
    staleTime: 5 * 60 * 1000,
    enabled: !!session?.worktree_branch,
  });

  const closeMutation = useMutation({
    mutationFn: () => invoke("close_issue", { repoPath, issueNumber: issue.number }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", repoPath] });
      setConfirmClose(false);
    },
  });

  const isWorktree = !!session?.worktree_branch;
  const sessionRepoPath = session?.worktree_repo || session?.project_path || repoPath;

  const { data: worktreeStatus, isLoading: statusLoading } = useQuery<WorktreeStatus>({
    queryKey: ["worktreeStatus", session?.worktree_path],
    queryFn: () =>
      invoke("check_worktree_status", {
        repoPath: sessionRepoPath,
        worktreePath: session!.worktree_path,
        branch: session!.worktree_branch,
      }),
    enabled: (confirmingRemove || mergeState === "confirming") && isWorktree,
    staleTime: 5_000,
  });

  const mergeWarnings = worktreeStatus?.has_dirty_files
    ? worktreeStatus.warnings.filter((w) => w.includes("uncommitted"))
    : [];
  const hasWarnings = !!worktreeStatus?.warnings.length;
  const hasMergeWarnings = mergeWarnings.length > 0;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["worktrees", sessionRepoPath] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["issues", repoPath] });
  };

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (isWorktree) {
        try {
          await invoke("remove_worktree", {
            repoPath: sessionRepoPath,
            worktreePath: session!.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
      }
      await invoke("remove_session", { sessionId: session!.id });
    },
    onSuccess: () => {
      setConfirmingRemove(false);
      invalidateAll();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      invoke<MergeResult>("try_merge_branch", {
        repoPath: sessionRepoPath,
        branch: session!.worktree_branch,
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
            repoPath: sessionRepoPath,
            worktreePath: session!.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
        await invoke("remove_session", { sessionId: session!.id });
      } else if (mode === "remove_worktree") {
        try {
          await invoke("remove_worktree", {
            repoPath: sessionRepoPath,
            worktreePath: session!.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
        await invoke("clear_session_worktree", { sessionId: session!.id });
      }
    },
    onSuccess: () => {
      setMergeState("idle");
      setMergeResult(null);
      invalidateAll();
    },
  });

  const conflictSessionMutation = useMutation({
    mutationFn: async () => {
      const mainPath = mergeResult?.main_worktree_path;
      if (!mainPath) throw new Error("No main worktree path");
      const prompt = `There are merge conflicts from merging '${session!.worktree_branch}' into ${defaultBranch ?? "main"}. Please resolve all conflicts, then commit the merge.`;
      const sessionId = await invoke<string>("create_session", {
        projectPath: mainPath,
        group: session!.group_path,
        title: `merge-${session!.worktree_branch}`,
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
          groupPath: session!.group_path,
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

  const isPending =
    removeMutation.isPending ||
    mergeMutation.isPending ||
    mergeCleanupMutation.isPending ||
    conflictSessionMutation.isPending ||
    abortMergeMutation.isPending;
  const mutationError =
    removeMutation.error ??
    mergeMutation.error ??
    mergeCleanupMutation.error ??
    conflictSessionMutation.error ??
    abortMergeMutation.error;

  const attention: AttentionStatus =
    summary?.attention ?? (session ? fallbackAttention(session.status) : "unknown");
  const statusInfo = ATTENTION_CONFIG[attention];

  const isFeatureBranch =
    session?.worktree_branch &&
    session.worktree_branch !== "main" &&
    session.worktree_branch !== "master" &&
    session.worktree_branch !== defaultBranch;

  const tmuxAlive = !session?.tmux_session || liveTmuxSessions?.has(session.tmux_session) !== false;

  if (session) {
    // "In Progress" mode — issue with linked session
    return (
      <div
        className={`session-card attention-${attention}`}
        onClick={() => onSelectSession?.(session)}
      >
        <div className="session-card-header">
          <div className="session-title-row">
            <span className="issue-number">#{issue.number}</span>
            <span className="session-title">{issue.title}</span>
          </div>
          <div className="session-badges">
            {!tmuxAlive && (
              <span className="status-badge status-tmux-dead" title="Tmux session not found">
                tmux dead
              </span>
            )}
            <span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span>
          </div>
        </div>
        {issue.labels.length > 0 && (
          <div className="issue-labels">
            {issue.labels.map((label) => (
              <span key={label.name} className="issue-label" style={labelStyle(label.color)}>
                {label.name}
              </span>
            ))}
          </div>
        )}
        <div className="session-card-body">
          {summary?.summary && <div className="session-summary">{summary.summary}</div>}
          {!summary?.summary && summary?.last_text && (
            <div className="session-summary session-last-text">{summary.last_text}</div>
          )}
        </div>
        {mutationError && <div className="session-wt-error">{String(mutationError)}</div>}
        <div className="session-card-footer">
          <div className="session-wt-actions">
            {isWorktree && mergeState === "idle" && !confirmingRemove && (
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
                  disabled={mergeCleanupMutation.isPending}
                >
                  Remove All
                </button>
                <button
                  className="wt-btn wt-btn-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    mergeCleanupMutation.mutate("remove_worktree");
                  }}
                  disabled={mergeCleanupMutation.isPending}
                >
                  Remove Worktree
                </button>
                <button
                  className="wt-btn wt-btn-cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    mergeCleanupMutation.mutate("keep");
                  }}
                  disabled={mergeCleanupMutation.isPending}
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
                  disabled={abortMergeMutation.isPending || conflictSessionMutation.isPending}
                >
                  Abort
                </button>
                <button
                  className="wt-btn wt-btn-merge"
                  onClick={(e) => {
                    e.stopPropagation();
                    conflictSessionMutation.mutate();
                  }}
                  disabled={abortMergeMutation.isPending || conflictSessionMutation.isPending}
                >
                  Resolve with Claude
                </button>
              </div>
            )}
            {mergeState === "idle" && !confirmingRemove && (
              <>
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
              </>
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

  // "To Do" mode — issue without session
  return (
    <div className="session-card attention-idle todo-card-idle">
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="issue-number">#{issue.number}</span>
          <span className="session-title">{issue.title}</span>
        </div>
      </div>
      {issue.labels.length > 0 && (
        <div className="issue-labels">
          {issue.labels.map((label) => (
            <span key={label.name} className="issue-label" style={labelStyle(label.color)}>
              {label.name}
            </span>
          ))}
        </div>
      )}
      {issue.body && (
        <div className="session-card-body">
          <div className="issue-body-preview">{issue.body}</div>
        </div>
      )}
      <div className="session-card-footer">
        <div className="session-wt-actions">
          <button
            className="wt-btn wt-btn-start"
            onClick={(e) => {
              e.stopPropagation();
              onStartIssue?.(issue);
            }}
          >
            Start
          </button>
          <button
            className="wt-btn wt-btn-action"
            onClick={(e) => {
              e.stopPropagation();
              onEditIssue?.(issue);
            }}
          >
            Edit
          </button>
          {!confirmClose ? (
            <button
              className="wt-btn wt-btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmClose(true);
              }}
            >
              Close
            </button>
          ) : (
            <>
              <button
                className="wt-btn wt-btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMutation.mutate();
                }}
                disabled={closeMutation.isPending}
              >
                Confirm
              </button>
              <button
                className="wt-btn wt-btn-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmClose(false);
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {closeMutation.error && <div className="session-wt-error">{String(closeMutation.error)}</div>}
    </div>
  );
}
