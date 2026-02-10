import { invoke } from "@tauri-apps/api/core";
import type { WorktreeActionsResult } from "../hooks/useWorktreeActions";

interface WorktreeActionsProps {
  actions: WorktreeActionsResult;
  projectPath: string;
  worktreeBranch: string;
  onShowDiff: () => void;
}

export function WorktreeActions({
  actions,
  projectPath,
  worktreeBranch,
  onShowDiff,
}: WorktreeActionsProps) {
  const {
    isWorktree,
    isFeatureBranch,
    defaultBranch,
    confirmingRemove,
    setConfirmingRemove,
    mergeState,
    setMergeState,
    worktreeStatus,
    statusLoading,
    mergeWarnings,
    hasWarnings,
    hasMergeWarnings,
    removeMutation,
    mergeMutation,
    mergeCleanupMutation,
    conflictSessionMutation,
    abortMergeMutation,
    isPending,
  } = actions;

  return (
    <div className="session-wt-actions">
      {isWorktree && mergeState === "idle" && !confirmingRemove && (
        <>
          <button
            className="wt-btn wt-btn-action"
            onClick={(e) => {
              e.stopPropagation();
              onShowDiff();
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
              title={`Merge ${worktreeBranch} into ${defaultBranch ?? "main"}`}
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
              invoke("open_in_terminal", { path: projectPath });
            }}
            disabled={isPending}
            title={`Open iTerm in ${projectPath}`}
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
  );
}
