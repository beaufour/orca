import type { AttentionStatus } from "./types";

export const ATTENTION_CONFIG: Record<AttentionStatus, { label: string; className: string }> = {
  needs_input: { label: "Needs Input", className: "status-needs-input" },
  error: { label: "Error", className: "status-error" },
  running: { label: "Running", className: "status-running" },
  idle: { label: "Idle", className: "status-idle" },
  stale: { label: "Stale", className: "status-stale" },
  unknown: { label: "Unknown", className: "status-stale" },
};

export function formatPath(path: string): string {
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

export function fallbackAttention(agentdeckStatus: string): AttentionStatus {
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

export function formatTime(epoch: number): string {
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

/** Check if a session is on the main/master branch (or has no worktree branch). */
export function isMainSession(worktreeBranch?: string): boolean {
  return !worktreeBranch || worktreeBranch === "main" || worktreeBranch === "master";
}

/** Extract leading issue number from a branch name like "42-fix-bug" */
export function extractIssueNumber(branch: string): number | null {
  const match = branch.match(/^(\d+)-/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/** Generate a branch name from an issue number and title */
export function issueToSlug(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
  return `${number}-${slug}`;
}

interface DiffLine {
  type: "addition" | "deletion" | "context";
  content: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      // Extract path from "diff --git a/path b/path"
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = {
        path: match?.[1] ?? line,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      files.push(currentFile);
    } else if (line.startsWith("@@") && currentFile) {
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "addition", content: line });
        if (currentFile) currentFile.additions++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "deletion", content: line });
        if (currentFile) currentFile.deletions++;
      } else {
        currentHunk.lines.push({ type: "context", content: line });
      }
    }
  }

  return files;
}

export function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function fileDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}
