import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GitHubIssue, Session, SessionSummary, AttentionStatus } from "../types";
import { ATTENTION_CONFIG, fallbackAttention, formatTime } from "../utils";
import { queryKeys } from "../queryKeys";
import { useWorktreeActions } from "../hooks/useWorktreeActions";
import { WorktreeActions } from "./WorktreeActions";
import { DiffViewer } from "./DiffViewer";

interface TodoCardProps {
  issue: GitHubIssue;
  session?: Session;
  repoPath: string;
  onSelectSession?: (session: Session) => void;
  onStartIssue?: (issue: GitHubIssue) => void;
  onEditIssue?: (issue: GitHubIssue) => void;
  liveTmuxSessions?: Set<string>;
  isFocused?: boolean;
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

function IssueLabels({ labels }: { labels: GitHubIssue["labels"] }) {
  if (labels.length === 0) return null;
  return (
    <div className="issue-labels">
      {labels.map((label) => (
        <span key={label.name} className="issue-label" style={labelStyle(label.color)}>
          {label.name}
        </span>
      ))}
    </div>
  );
}

/** "In Progress" mode — issue with linked session */
function TodoCardInProgress({
  issue,
  session,
  repoPath,
  onSelectSession,
  liveTmuxSessions,
  isFocused,
}: {
  issue: GitHubIssue;
  session: Session;
  repoPath: string;
  onSelectSession?: (session: Session) => void;
  liveTmuxSessions?: Set<string>;
  isFocused?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);

  const { data: summary } = useQuery<SessionSummary>({
    queryKey: queryKeys.summary(session.id),
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

  const sessionRepoPath = session.worktree_repo || session.project_path || repoPath;

  const actions = useWorktreeActions({
    session,
    repoPath: sessionRepoPath,
    onSelectSession,
    extraInvalidateKeys: [["issues", repoPath]],
  });

  const attention: AttentionStatus = summary?.attention ?? fallbackAttention(session.status);
  const statusInfo = ATTENTION_CONFIG[attention];
  const tmuxAlive = !session.tmux_session || liveTmuxSessions?.has(session.tmux_session) !== false;

  return (
    <div
      ref={cardRef}
      className={`session-card attention-${attention}${isFocused ? " session-card-focused" : ""}`}
      onClick={() => onSelectSession?.(session)}
    >
      <div className="session-card-header">
        <div className="session-title-row">
          <span
            className="issue-number issue-number-link"
            onClick={(e) => {
              e.stopPropagation();
              openUrl(issue.html_url);
            }}
            title="Open issue in browser"
          >
            #{issue.number}
          </span>
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
      <IssueLabels labels={issue.labels} />
      <div className="session-card-body">
        {summary?.summary && <div className="session-summary">{summary.summary}</div>}
        {!summary?.summary && summary?.last_text && (
          <div className="session-summary session-last-text">{summary.last_text}</div>
        )}
      </div>
      {actions.mutationError && (
        <div className="session-wt-error">{String(actions.mutationError)}</div>
      )}
      <div className="session-card-footer">
        <WorktreeActions
          actions={actions}
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

export function TodoCard({
  issue,
  session,
  repoPath,
  onSelectSession,
  onStartIssue,
  onEditIssue,
  liveTmuxSessions,
  isFocused,
}: TodoCardProps) {
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  const closeMutation = useMutation({
    mutationFn: () => invoke("close_issue", { repoPath, issueNumber: issue.number }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(repoPath) });
      setConfirmClose(false);
    },
  });

  if (session) {
    return (
      <TodoCardInProgress
        issue={issue}
        session={session}
        repoPath={repoPath}
        onSelectSession={onSelectSession}
        liveTmuxSessions={liveTmuxSessions}
        isFocused={isFocused}
      />
    );
  }

  // "To Do" mode — issue without session
  return (
    <div className="session-card attention-idle todo-card-idle">
      <div className="session-card-header">
        <div className="session-title-row">
          <span
            className="issue-number issue-number-link"
            onClick={(e) => {
              e.stopPropagation();
              openUrl(issue.html_url);
            }}
            title="Open issue in browser"
          >
            #{issue.number}
          </span>
          <span className="session-title">{issue.title}</span>
        </div>
      </div>
      <IssueLabels labels={issue.labels} />
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
