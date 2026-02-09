import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group, Session, GitHubIssue } from "../types";
import { extractIssueNumber, issueToSlug } from "../utils";
import { TodoCard } from "./TodoCard";
import { SessionCard } from "./SessionCard";
import { SessionList } from "./SessionList";
import { IssueModal } from "./IssueModal";

interface TodoListProps {
  group: Group;
  sessions: Session[] | undefined;
  onSelectSession: (session: Session) => void;
  liveTmuxSessions?: Set<string>;
  sessionsLoading?: boolean;
  sessionsError?: Error | null;
  onRetry?: () => void;
  confirmingRemoveId?: string | null;
  onConfirmingRemoveChange?: (sessionId: string | null) => void;
  focusedIndex?: number;
  refetchSessions: () => Promise<{ data: Session[] | undefined }>;
}

export function TodoList({
  group,
  sessions,
  onSelectSession,
  liveTmuxSessions,
  sessionsLoading,
  sessionsError,
  onRetry,
  confirmingRemoveId,
  onConfirmingRemoveChange,
  focusedIndex = -1,
  refetchSessions,
}: TodoListProps) {
  const [showUnlinked, setShowUnlinked] = useState(false);
  const [issueModal, setIssueModal] = useState<{
    mode: "create" | "edit";
    issue?: GitHubIssue;
  } | null>(null);

  const {
    data: issues,
    error: issuesError,
    isLoading: issuesLoading,
  } = useQuery<GitHubIssue[]>({
    queryKey: ["issues", group.default_path],
    queryFn: () => invoke("list_issues", { repoPath: group.default_path }),
    refetchInterval: 30_000,
  });

  // Build issue-session mapping
  const { inProgress, todo, unlinked } = useMemo(() => {
    if (!issues || !sessions) {
      return { inProgress: [], todo: [], unlinked: [] };
    }

    const issueByNumber = new Map<number, GitHubIssue>();
    for (const issue of issues) {
      issueByNumber.set(issue.number, issue);
    }

    const matchedIssueNumbers = new Set<number>();
    const sessionsByIssue = new Map<number, Session>();
    const unlinkedSessions: Session[] = [];

    for (const session of sessions) {
      if (!session.worktree_branch) {
        unlinkedSessions.push(session);
        continue;
      }
      const issueNum = extractIssueNumber(session.worktree_branch);
      if (issueNum !== null && issueByNumber.has(issueNum)) {
        matchedIssueNumbers.add(issueNum);
        // Keep the most recently accessed session per issue
        const existing = sessionsByIssue.get(issueNum);
        if (!existing || session.last_accessed > existing.last_accessed) {
          sessionsByIssue.set(issueNum, session);
          if (existing) unlinkedSessions.push(existing);
        } else {
          unlinkedSessions.push(session);
        }
      } else {
        unlinkedSessions.push(session);
      }
    }

    const inProgressItems: { issue: GitHubIssue; session: Session }[] = [];
    for (const [issueNum, session] of sessionsByIssue) {
      const issue = issueByNumber.get(issueNum)!;
      inProgressItems.push({ issue, session });
    }
    // Sort by most recently accessed
    inProgressItems.sort((a, b) => b.session.last_accessed - a.session.last_accessed);

    const todoItems = issues.filter((issue) => !matchedIssueNumbers.has(issue.number));

    return {
      inProgress: inProgressItems,
      todo: todoItems,
      unlinked: unlinkedSessions,
    };
  }, [issues, sessions]);

  const createSessionMutation = useMutation({
    mutationFn: async (issue: GitHubIssue) => {
      const branch = issueToSlug(issue.number, issue.title);
      const prompt = [
        `GitHub Issue #${issue.number}: ${issue.title}`,
        "",
        issue.body || "(no description)",
        "",
        "Please review the issue above and the codebase, then wait for further instructions.",
      ].join("\n");

      const sessionId = await invoke<string>("create_session", {
        projectPath: group.default_path,
        group: group.path,
        title: issue.title,
        tool: "claude",
        worktreeBranch: branch,
        newBranch: true,
        start: true,
        prompt,
      });
      return sessionId;
    },
    onSuccess: async (sessionId) => {
      const { data } = await refetchSessions();
      const newSession = data?.find((s) => s.id === sessionId);
      if (newSession) {
        onSelectSession(newSession);
      }
    },
  });

  // If issues failed to load, fall back to regular SessionList
  if (issuesError) {
    return (
      <div>
        <div className="todo-github-error">GitHub issues unavailable: {String(issuesError)}</div>
        <SessionList
          sessions={sessions}
          onSelectSession={onSelectSession}
          selectedSessionId={null}
          focusedIndex={focusedIndex}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={onRetry}
          confirmingRemoveId={confirmingRemoveId}
          onConfirmingRemoveChange={onConfirmingRemoveChange}
          groupPath={group.path}
          repoPath={group.default_path}
          liveTmuxSessions={liveTmuxSessions}
        />
      </div>
    );
  }

  if (issuesLoading && !issues) {
    return (
      <div className="session-list-empty">
        <div className="loading-row">
          <span className="spinner" /> Loading issues...
        </div>
      </div>
    );
  }

  return (
    <div className="todo-list">
      {createSessionMutation.error && (
        <div className="todo-github-error">{String(createSessionMutation.error)}</div>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <div className="todo-section">
          <div className="todo-section-header">
            <span>In Progress</span>
            <span className="todo-section-count">{inProgress.length}</span>
          </div>
          <div className="session-grid">
            {inProgress.map(({ issue, session }) => (
              <TodoCard
                key={issue.number}
                issue={issue}
                session={session}
                repoPath={group.default_path}
                onSelectSession={onSelectSession}
                liveTmuxSessions={liveTmuxSessions}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unlinked Sessions */}
      {unlinked.length > 0 && (
        <div className="todo-section">
          <button
            className="todo-section-header todo-section-header-collapsible"
            onClick={() => setShowUnlinked(!showUnlinked)}
          >
            <span>Unlinked Sessions {showUnlinked ? "▾" : "▸"}</span>
            <span className="todo-section-count">{unlinked.length}</span>
          </button>
          {showUnlinked && (
            <div className="session-grid">
              {unlinked.map((session, index) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={() => onSelectSession(session)}
                  onSelectSession={onSelectSession}
                  isFocused={index === focusedIndex}
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
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* To Do */}
      <div className="todo-section">
        <div className="todo-section-header">
          <span>To Do</span>
          <div className="todo-section-header-right">
            <span className="todo-section-count">{todo.length}</span>
            <button
              className="wt-btn wt-btn-add todo-new-issue-btn"
              onClick={() => setIssueModal({ mode: "create" })}
            >
              + New Issue
            </button>
          </div>
        </div>
        {todo.length === 0 && (
          <div className="todo-empty">No open issues without active sessions</div>
        )}
        <div className="session-grid">
          {todo.map((issue) => (
            <TodoCard
              key={issue.number}
              issue={issue}
              repoPath={group.default_path}
              onSelectSession={onSelectSession}
              onStartIssue={(issue) => createSessionMutation.mutate(issue)}
              onEditIssue={(issue) => setIssueModal({ mode: "edit", issue })}
              liveTmuxSessions={liveTmuxSessions}
            />
          ))}
        </div>
      </div>

      {issueModal && (
        <IssueModal
          mode={issueModal.mode}
          issue={issueModal.issue}
          repoPath={group.default_path}
          onClose={() => setIssueModal(null)}
        />
      )}
    </div>
  );
}
