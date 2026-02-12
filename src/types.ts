export interface Group {
  path: string;
  name: string;
  expanded: boolean;
  sort_order: number;
  default_path: string;
  github_issues_enabled: boolean;
  is_git_repo: boolean;
  merge_workflow: "merge" | "pr";
  worktree_command: string | null;
  component_depth: number;
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
  prompt: string | null;
  pr_url: string | null;
  pr_number: number | null;
  pr_state: string | null;
}

export type AttentionStatus = "needs_input" | "error" | "running" | "idle" | "stale" | "unknown";

export interface SessionSummary {
  summary: string | null;
  initial_prompt: string | null;
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

export interface MergeResult {
  success: boolean;
  main_worktree_path: string;
  conflict_message: string | null;
}

export interface WorktreeStatus {
  has_dirty_files: boolean;
  has_unmerged_branch: boolean;
  has_unpushed_commits: boolean;
  warnings: string[];
}

export interface PrInfo {
  number: number;
  url: string;
  state: string;
}

export interface RebaseResult {
  success: boolean;
  conflict_message: string | null;
}

export interface PushResult {
  success: boolean;
  message: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: GitHubLabel[];
  assignee: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
}
