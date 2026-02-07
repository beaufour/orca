export interface Group {
  path: string;
  name: string;
  expanded: boolean;
  sort_order: number;
  default_path: string;
}

export interface Session {
  id: string;
  title: string;
  project_path: string;
  group_path: string;
  sort_order: number;
  status: string;
  tmux_session: string;
  created_at: number;
  last_accessed: number;
  worktree_path: string;
  worktree_repo: string;
  worktree_branch: string;
  claude_session_id: string | null;
}

export type AttentionStatus =
  | "needs_input"
  | "error"
  | "running"
  | "idle"
  | "stale"
  | "unknown";

export interface SessionSummary {
  summary: string | null;
  attention: AttentionStatus;
  last_tool: string | null;
  last_text: string | null;
}

export interface Worktree {
  path: string;
  head: string;
  branch: string;
  is_bare: boolean;
}
