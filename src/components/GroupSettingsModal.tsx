import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group } from "../types";

interface GroupSettingsModalProps {
  group: Group;
  onClose: () => void;
}

export function GroupSettingsModal({ group, onClose }: GroupSettingsModalProps) {
  const [githubIssuesEnabled, setGithubIssuesEnabled] = useState(group.github_issues_enabled);
  const [mergeWorkflow, setMergeWorkflow] = useState(group.merge_workflow);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      invoke("update_group_settings", {
        groupPath: group.path,
        githubIssuesEnabled: githubIssuesEnabled,
        mergeWorkflow: mergeWorkflow,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (
      githubIssuesEnabled === group.github_issues_enabled &&
      mergeWorkflow === group.merge_workflow
    ) {
      onClose();
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Settings: {group.name}</h3>
        <label
          className="settings-toggle"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
        >
          <input
            type="checkbox"
            checked={githubIssuesEnabled}
            onChange={(e) => setGithubIssuesEnabled(e.target.checked)}
            autoFocus
          />
          <span className="settings-toggle-label">Enable GitHub Issues</span>
        </label>
        <p className="settings-toggle-description">
          Show GitHub issues as a todo list for this group. Disable if this group is not backed by a
          GitHub repository.
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
        {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-add"
            onClick={handleSubmit}
            disabled={mutation.isPending}
          >
            Save
          </button>
          <button className="wt-btn wt-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
