export const queryKeys = {
  sessions: (groupPath?: string | null) =>
    groupPath ? (["sessions", groupPath] as const) : (["sessions"] as const),
  attentionSessions: ["sessions", "__needs_action__"] as const,
  groups: ["groups"] as const,
  tmuxSessions: ["tmuxSessions"] as const,
  worktreeStatus: (path: string) => ["worktreeStatus", path] as const,
  worktrees: (repoPath: string) => ["worktrees", repoPath] as const,
  defaultBranch: (repoPath: string) => ["defaultBranch", repoPath] as const,
  branchDiff: (sessionId: string) => ["branch-diff", sessionId] as const,
  summary: (sessionId: string) => ["summary", sessionId] as const,
  issues: (repoPath: string) => ["issues", repoPath] as const,
};
