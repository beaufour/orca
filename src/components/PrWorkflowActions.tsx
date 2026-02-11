import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PrWorkflowActionsResult } from "../hooks/usePrWorkflowActions";
import { CreatePrModal } from "./CreatePrModal";
import { extractIssueNumber } from "../utils";

interface PrWorkflowActionsProps {
  actions: PrWorkflowActionsResult;
  projectPath: string;
  worktreeBranch: string;
  sessionTitle: string;
  onShowDiff: () => void;
}

export function PrWorkflowActions({
  actions,
  projectPath,
  worktreeBranch,
  sessionTitle,
  onShowDiff,
}: PrWorkflowActionsProps) {
  const {
    prState,
    isWorktree,
    isFeatureBranch,
    defaultBranch,
    statusLoading,
    prWarnings,
    hasPrWarnings,
    prInfo,
    mainUpdateWarning,
    removeMutation,
    rebaseAndPushMutation,
    abortRebaseMutation,
    conflictSessionMutation,
    cleanupMutation,
    isPending,
    startPrFlow,
    confirmPrFlow,
    submitPr,
    cancelPrFlow,
  } = actions;

  // Idle: [Diff] [PR] ... [Remove] [Term]
  if (prState === "idle" && isWorktree) {
    return (
      <div className="session-wt-actions">
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
            className="wt-btn wt-btn-pr"
            onClick={(e) => {
              e.stopPropagation();
              startPrFlow();
            }}
            disabled={isPending}
            title={`Create PR for ${worktreeBranch}`}
          >
            PR
          </button>
        )}
        <button
          className="wt-btn wt-btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            removeMutation.mutate();
          }}
          disabled={isPending}
          title="Remove worktree and session"
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
      </div>
    );
  }

  // Confirming: warnings + [Confirm] [Cancel]
  if (prState === "confirming") {
    return (
      <div className="session-wt-actions">
        {statusLoading && (
          <span className="loading-row">
            <span className="spinner" />
          </span>
        )}
        {hasPrWarnings && (
          <div className="remove-warnings">
            {prWarnings.map((w, i) => (
              <span key={i} className="remove-warning-item">
                {w}
              </span>
            ))}
          </div>
        )}
        <span className="merge-label">Create PR for {worktreeBranch}?</span>
        <button
          className="wt-btn wt-btn-pr"
          onClick={(e) => {
            e.stopPropagation();
            confirmPrFlow();
          }}
          disabled={isPending || statusLoading}
        >
          Confirm
        </button>
        <button
          className="wt-btn wt-btn-cancel"
          onClick={(e) => {
            e.stopPropagation();
            cancelPrFlow();
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // Rebasing
  if (prState === "rebasing") {
    return (
      <div className="session-wt-actions">
        <span className="loading-row">
          <span className="spinner" /> Rebasing on {defaultBranch ?? "main"}...
        </span>
      </div>
    );
  }

  // Rebase conflict
  if (prState === "rebase_conflict") {
    return (
      <div className="session-wt-actions">
        <span className="merge-conflict-label">Rebase Conflict</span>
        <button
          className="wt-btn wt-btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            abortRebaseMutation.mutate();
          }}
          disabled={abortRebaseMutation.isPending || conflictSessionMutation.isPending}
        >
          Abort
        </button>
        <button
          className="wt-btn wt-btn-pr"
          onClick={(e) => {
            e.stopPropagation();
            conflictSessionMutation.mutate();
          }}
          disabled={abortRebaseMutation.isPending || conflictSessionMutation.isPending}
        >
          Resolve with Claude
        </button>
      </div>
    );
  }

  // Pushing
  if (prState === "pushing") {
    return (
      <div className="session-wt-actions">
        <span className="loading-row">
          <span className="spinner" /> Pushing...
        </span>
      </div>
    );
  }

  // Editing PR (show modal)
  if (prState === "editing_pr") {
    const issueNum = extractIssueNumber(worktreeBranch);
    const defaultBody = issueNum ? `Closes #${issueNum}` : `Branch: ${worktreeBranch}`;

    return (
      <>
        <div className="session-wt-actions">
          <span className="loading-row">Waiting for PR details...</span>
        </div>
        <CreatePrModal
          branch={worktreeBranch}
          sessionTitle={sessionTitle}
          defaultBody={defaultBody}
          baseBranch={defaultBranch ?? "main"}
          onSubmit={submitPr}
          onCancel={cancelPrFlow}
        />
      </>
    );
  }

  // Creating PR
  if (prState === "creating_pr") {
    return (
      <div className="session-wt-actions">
        <span className="loading-row">
          <span className="spinner" /> Creating PR...
        </span>
      </div>
    );
  }

  // PR open
  if (prState === "pr_open" && prInfo) {
    return (
      <div className="session-wt-actions">
        <span
          className="pr-link"
          onClick={(e) => {
            e.stopPropagation();
            openUrl(prInfo.url);
          }}
          title="Open PR in browser"
        >
          PR #{prInfo.number} ↗
        </span>
        <button
          className="wt-btn wt-btn-action"
          onClick={(e) => {
            e.stopPropagation();
            rebaseAndPushMutation.mutate();
          }}
          disabled={isPending}
          title="Rebase on main and force-push"
        >
          Rebase &amp; Push
        </button>
        <button
          className="wt-btn wt-btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            removeMutation.mutate();
          }}
          disabled={isPending}
          title="Remove worktree and session"
        >
          Remove
        </button>
      </div>
    );
  }

  // PR merged
  if (prState === "pr_merged") {
    return (
      <div className="merge-cleanup">
        <span className="pr-merged-label">PR Merged!</span>
        {mainUpdateWarning && (
          <div className="remove-warnings">
            <span className="remove-warning-item">Main not updated: {mainUpdateWarning}</span>
          </div>
        )}
        <button
          className="wt-btn wt-btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            cleanupMutation.mutate("remove_all");
          }}
          disabled={cleanupMutation.isPending}
        >
          Remove All
        </button>
        <button
          className="wt-btn wt-btn-action"
          onClick={(e) => {
            e.stopPropagation();
            cleanupMutation.mutate("remove_worktree");
          }}
          disabled={cleanupMutation.isPending}
        >
          Remove Worktree
        </button>
        <button
          className="wt-btn wt-btn-cancel"
          onClick={(e) => {
            e.stopPropagation();
            cleanupMutation.mutate("keep");
          }}
          disabled={cleanupMutation.isPending}
        >
          Keep
        </button>
      </div>
    );
  }

  // Fallback for non-worktree or no-feature-branch: just show Remove/Term
  return (
    <div className="session-wt-actions">
      <button
        className="wt-btn wt-btn-danger"
        onClick={(e) => {
          e.stopPropagation();
          removeMutation.mutate();
        }}
        disabled={isPending}
        title="Remove session"
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
    </div>
  );
}
