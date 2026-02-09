import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubIssue } from "../types";

interface IssueModalProps {
  mode: "create" | "edit";
  issue?: GitHubIssue;
  repoPath: string;
  onClose: () => void;
}

export function IssueModal({ mode, issue, repoPath, onClose }: IssueModalProps) {
  const [title, setTitle] = useState(issue?.title ?? "");
  const [body, setBody] = useState(issue?.body ?? "");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      invoke<GitHubIssue>("create_issue", {
        repoPath,
        title: title.trim(),
        body: body.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", repoPath] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      invoke<GitHubIssue>("update_issue", {
        repoPath,
        issueNumber: issue!.number,
        title: title.trim(),
        body: body.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", repoPath] });
      onClose();
    },
  });

  const mutation = mode === "create" ? createMutation : updateMutation;

  const handleSubmit = () => {
    if (!title.trim()) return;
    mutation.mutate();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">
          {mode === "create" ? "New Issue" : `Edit Issue #${issue?.number}`}
        </h3>
        <label className="modal-label">Title</label>
        <input
          className="modal-input"
          type="text"
          placeholder="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          autoFocus
        />
        <label className="modal-label">Description</label>
        <textarea
          className="modal-input modal-textarea"
          placeholder="Issue description (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          rows={6}
        />
        {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-add"
            onClick={handleSubmit}
            disabled={!title.trim() || mutation.isPending}
          >
            {mode === "create" ? "Create" : "Save"}
          </button>
          <button className="wt-btn wt-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
