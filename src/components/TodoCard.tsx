import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubIssue, Session, SessionSummary, AttentionStatus } from "../types";
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
        <div className="session-card-footer">
          <div className="session-wt-actions">
            {isFeatureBranch && (
              <button
                className="wt-btn wt-btn-action"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDiff(true);
                }}
                title="Show diff vs main"
              >
                Diff
              </button>
            )}
          </div>
          <span className="session-time">wt:{session.worktree_branch}</span>
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
