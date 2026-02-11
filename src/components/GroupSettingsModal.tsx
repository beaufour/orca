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
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      invoke("update_group_settings", {
        groupPath: group.path,
        githubIssuesEnabled: githubIssuesEnabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (githubIssuesEnabled === group.github_issues_enabled) {
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
