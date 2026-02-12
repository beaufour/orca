import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group } from "../types";
import { queryKeys } from "../queryKeys";
import { Modal } from "./Modal";

interface GroupSettingsModalProps {
  group: Group;
  onClose: () => void;
}

export function GroupSettingsModal({ group, onClose }: GroupSettingsModalProps) {
  const [githubIssuesEnabled, setGithubIssuesEnabled] = useState(group.github_issues_enabled);
  const [mergeWorkflow, setMergeWorkflow] = useState(group.merge_workflow);
  const [worktreeCommand, setWorktreeCommand] = useState(group.worktree_command ?? "");
  const [componentDepth, setComponentDepth] = useState(group.component_depth);
  const queryClient = useQueryClient();

  const hasComponentPlaceholder = worktreeCommand.includes("{component}");

  const mutation = useMutation({
    mutationFn: () =>
      invoke("update_group_settings", {
        groupPath: group.path,
        githubIssuesEnabled: githubIssuesEnabled,
        mergeWorkflow: mergeWorkflow,
        worktreeCommand: worktreeCommand.trim() || null,
        componentDepth: componentDepth,
      }),
    onSuccess: () => {
      queryClient.setQueryData<Group[]>(queryKeys.groups, (old) =>
        old?.map((g) =>
          g.path === group.path
            ? {
                ...g,
                github_issues_enabled: githubIssuesEnabled,
                merge_workflow: mergeWorkflow,
                worktree_command: worktreeCommand.trim() || null,
                component_depth: componentDepth,
              }
            : g,
        ),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      onClose();
    },
  });

  const isDirty =
    githubIssuesEnabled !== group.github_issues_enabled ||
    mergeWorkflow !== group.merge_workflow ||
    (worktreeCommand.trim() || null) !== (group.worktree_command ?? null) ||
    componentDepth !== group.component_depth;

  const handleSubmit = () => {
    if (!isDirty) {
      onClose();
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="modal-title">Settings: {group.name}</h3>
      <label
        className={`settings-toggle${!group.is_git_repo ? " settings-toggle-disabled" : ""}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onClose();
        }}
      >
        <input
          type="checkbox"
          checked={githubIssuesEnabled && group.is_git_repo}
          onChange={(e) => setGithubIssuesEnabled(e.target.checked)}
          disabled={!group.is_git_repo}
          autoFocus
        />
        <span className="settings-toggle-label">Enable GitHub Issues</span>
      </label>
      <p className="settings-toggle-description">
        {group.is_git_repo
          ? "Show GitHub issues as a todo list for this group."
          : "GitHub Issues requires a git repository."}
      </p>
      <div className="settings-radio-group">
        <span className="settings-radio-label">Merge Workflow</span>
        <label className="settings-radio-option">
          <input
            type="radio"
            name="mergeWorkflow"
            value="merge"
            checked={mergeWorkflow === "merge"}
            onChange={() => setMergeWorkflow("merge")}
          />
          <span className="settings-radio-text">
            <strong>Direct Merge</strong> — merge branches locally into main
          </span>
        </label>
        <label className="settings-radio-option">
          <input
            type="radio"
            name="mergeWorkflow"
            value="pr"
            checked={mergeWorkflow === "pr"}
            onChange={() => setMergeWorkflow("pr")}
          />
          <span className="settings-radio-text">
            <strong>Pull Request</strong> — push branches and create GitHub PRs
          </span>
        </label>
      </div>
      {group.is_git_repo && (
        <div className="settings-section">
          <span className="settings-radio-label">Worktree Script</span>
          <input
            className="wt-input"
            type="text"
            placeholder="~/bin/my-script create {branch} -c {component}"
            value={worktreeCommand}
            onChange={(e) => setWorktreeCommand(e.target.value)}
            spellCheck={false}
          />
          <p className="settings-toggle-description">
            Custom command to create worktrees. Use <code>{"{branch}"}</code> for the branch name
            {" and "}
            <code>{"{component}"}</code> for sparse checkout components.
          </p>
          {hasComponentPlaceholder && (
            <div className="settings-depth-row">
              <label className="settings-depth-label">
                Component depth:
                <input
                  className="wt-input settings-depth-input"
                  type="number"
                  min={1}
                  max={5}
                  value={componentDepth}
                  onChange={(e) =>
                    setComponentDepth(Math.max(1, Math.min(5, Number(e.target.value))))
                  }
                />
              </label>
              <span className="settings-toggle-description">
                Directory depth for component listing (e.g. 2 = <code>foo/bar</code>)
              </span>
            </div>
          )}
        </div>
      )}
      {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
      <div className="modal-actions">
        <button className="wt-btn wt-btn-add" onClick={handleSubmit} disabled={mutation.isPending}>
          Save
        </button>
        <button className="wt-btn wt-btn-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
