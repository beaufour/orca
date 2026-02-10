import type { AttentionStatus } from "./types";

export const ATTENTION_CONFIG: Record<AttentionStatus, { label: string; className: string }> = {
  needs_input: { label: "Needs Input", className: "status-needs-input" },
  error: { label: "Error", className: "status-error" },
  running: { label: "Running", className: "status-running" },
  idle: { label: "Idle", className: "status-idle" },
  stale: { label: "Stale", className: "status-stale" },
  unknown: { label: "Unknown", className: "status-stale" },
};

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
