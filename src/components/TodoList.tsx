import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group, Session, GitHubIssue } from "../types";
import type { PendingCreation } from "../hooks/useSessionCreation";
import { extractIssueNumber, issueToSlug } from "../utils";
import { queryKeys } from "../queryKeys";
import { TodoCard } from "./TodoCard";
import { SessionCard } from "./SessionCard";
import { SessionList } from "./SessionList";
import { PendingSessionCard } from "./PendingSessionCard";
import { IssueModal } from "./IssueModal";

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
  pendingCreations?: Map<string, PendingCreation>;
  onDismissPending?: (creationId: string) => void;
  createSession?: (params: CreateSessionParams) => void;
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
  pendingCreations,
  onDismissPending,
  createSession,
}: TodoListProps) {
  const [issueModal, setIssueModal] = useState<{
    mode: "create" | "edit";
    issue?: GitHubIssue;
  } | null>(null);

  const {
    data: issues,
    error: issuesError,
    isLoading: issuesLoading,
  } = useQuery<GitHubIssue[]>({
    queryKey: queryKeys.issues(group.default_path),
    queryFn: () => invoke("list_issues", { repoPath: group.default_path }),
    refetchInterval: 30_000,
  });

  // Build issue-session mapping
  type SessionItem =
    | { type: "linked"; issue: GitHubIssue; session: Session }
    | { type: "unlinked"; session: Session };

  const { allSessions, todo } = useMemo(() => {
    if (!sessions) {
      return { allSessions: [] as SessionItem[], todo: [] as GitHubIssue[] };
    }

    // If issues haven't loaded yet, show all sessions as unlinked
    if (!issues) {
      return {
        allSessions: sessions.map((session) => ({ type: "unlinked" as const, session })),
        todo: [] as GitHubIssue[],
      };
    }

    const issueByNumber = new Map<number, GitHubIssue>();
    for (const issue of issues) {
      issueByNumber.set(issue.number, issue);
    }

    const matchedIssueNumbers = new Set<number>();
    const sessionsByIssue = new Map<number, Session>();
    const items: SessionItem[] = [];

    // First pass: find the best session per issue
    for (const session of sessions) {
      if (!session.worktree_branch) {
        continue;
      }
      const issueNum = extractIssueNumber(session.worktree_branch);
      if (issueNum !== null && issueByNumber.has(issueNum)) {
        matchedIssueNumbers.add(issueNum);
        const existing = sessionsByIssue.get(issueNum);
        if (!existing || session.last_accessed > existing.last_accessed) {
          sessionsByIssue.set(issueNum, session);
        }
      }
    }

    // Second pass: build unified list
    for (const session of sessions) {
      const issueNum = session.worktree_branch ? extractIssueNumber(session.worktree_branch) : null;
      if (issueNum !== null && sessionsByIssue.get(issueNum) === session) {
        items.push({ type: "linked", issue: issueByNumber.get(issueNum)!, session });
      } else {
        items.push({ type: "unlinked", session });
      }
    }

    // Keep input order (already sorted by filteredSessions in App.tsx)
    // so that focusedIndex matches the visual order.

    const todoItems = issues.filter((issue) => !matchedIssueNumbers.has(issue.number));

    return {
      allSessions: items,
      todo: todoItems,
    };
  }, [issues, sessions]);

  const handleStartIssue = (issue: GitHubIssue) => {
    if (!createSession) return;
    const branch = issueToSlug(issue.number, issue.title);
    const prompt = `Please work on GitHub Issue #${issue.number} (${issue.html_url}). Review the issue and the codebase, then wait for further instructions.`;

    // Assign the issue to ourselves on GitHub (fire-and-forget)
    invoke("assign_issue", {
      repoPath: group.default_path,
      issueNumber: issue.number,
    }).catch((err) => console.warn("Failed to assign issue:", err));

    createSession({
      projectPath: group.default_path,
      group: group.path,
      title: issue.title,
      tool: "claude",
      worktreeBranch: branch,
      newBranch: true,
      start: true,
      prompt,
    });
  };

  // Filter pending creations to this group
  const groupPending = pendingCreations
    ? Array.from(pendingCreations.values()).filter((p) => p.groupPath === group.path)
    : [];

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

  return (
    <div className="todo-list">
      {/* Sessions */}
      {(allSessions.length > 0 || groupPending.length > 0) && (
        <div className="todo-section">
          <div className="todo-section-header">
            <span>Sessions</span>
            <span className="todo-section-count">{allSessions.length + groupPending.length}</span>
          </div>
          <div className="session-grid">
            {allSessions.map((item, index) =>
              item.type === "linked" ? (
                <TodoCard
                  key={item.session.id}
                  issue={item.issue}
                  session={item.session}
                  repoPath={group.default_path}
                  onSelectSession={onSelectSession}
                  liveTmuxSessions={liveTmuxSessions}
                  isFocused={index === focusedIndex}
                  mergeWorkflow={group.merge_workflow}
                />
              ) : (
                <SessionCard
                  key={item.session.id}
                  session={item.session}
                  onClick={() => onSelectSession(item.session)}
                  onSelectSession={onSelectSession}
                  isFocused={index === focusedIndex}
                  confirmingRemove={
                    confirmingRemoveId != null ? item.session.id === confirmingRemoveId : undefined
                  }
                  onConfirmingRemoveChange={
                    onConfirmingRemoveChange
                      ? (c) => onConfirmingRemoveChange(c ? item.session.id : null)
                      : undefined
                  }
                  tmuxAlive={
                    !item.session.tmux_session ||
                    liveTmuxSessions?.has(item.session.tmux_session) !== false
                  }
                  mergeWorkflow={group.merge_workflow}
                />
              ),
            )}
            {groupPending.map((pending) => (
              <PendingSessionCard
                key={pending.creationId}
                pending={pending}
                onDismiss={() => onDismissPending?.(pending.creationId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* To Do */}
      <div className="todo-section">
        <div className="todo-section-header">
          <span>To Do</span>
          <div className="todo-section-header-right">
            {issuesLoading && !issues ? (
              <span className="spinner" />
            ) : (
              <span className="todo-section-count">{todo.length}</span>
            )}
            <button
              className="wt-btn wt-btn-add todo-new-issue-btn"
              onClick={() => setIssueModal({ mode: "create" })}
            >
              + New Issue
            </button>
          </div>
        </div>
        {!issuesLoading && todo.length === 0 && (
          <div className="todo-empty">No open issues without active sessions</div>
        )}
        <div className="session-grid">
          {todo.map((issue) => (
            <TodoCard
              key={issue.number}
              issue={issue}
              repoPath={group.default_path}
              onSelectSession={onSelectSession}
              onStartIssue={handleStartIssue}
              onEditIssue={(issue) => setIssueModal({ mode: "edit", issue })}
              liveTmuxSessions={liveTmuxSessions}
              mergeWorkflow={group.merge_workflow}
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
