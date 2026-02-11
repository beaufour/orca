import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubIssue } from "../types";
import { queryKeys } from "../queryKeys";
import { Modal } from "./Modal";

const LABEL_OPTIONS = ["bug", "documentation", "enhancement"] as const;

interface IssueModalProps {
  mode: "create" | "edit";
  issue?: GitHubIssue;
  repoPath: string;
  onClose: () => void;
}

export function IssueModal({ mode, issue, repoPath, onClose }: IssueModalProps) {
  const [title, setTitle] = useState(issue?.title ?? "");
  const [body, setBody] = useState(issue?.body ?? "");
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(
    () =>
      new Set(
        issue?.labels
          .map((l) => l.name)
          .filter((n) => LABEL_OPTIONS.includes(n as (typeof LABEL_OPTIONS)[number])) ?? [],
      ),
  );
  const queryClient = useQueryClient();

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      invoke<GitHubIssue>("create_issue", {
        repoPath,
        title: title.trim(),
        body: body.trim(),
        labels: [...selectedLabels],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(repoPath) });
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
        labels: [...selectedLabels],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(repoPath) });
      onClose();
    },
  });

  const mutation = mode === "create" ? createMutation : updateMutation;

  const handleSubmit = () => {
    if (!title.trim()) return;
    mutation.mutate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey && title.trim()) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") onClose();
  };

  return (
    <Modal onClose={onClose} className="modal-content modal-content-wide">
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
          if (e.key === "Enter" && !e.metaKey && !e.shiftKey) handleSubmit();
          handleKeyDown(e);
        }}
        autoFocus
      />
      <label className="modal-label">Labels</label>
      <div className="issue-label-picker">
        {LABEL_OPTIONS.map((label) => (
          <button
            key={label}
            type="button"
            className={`issue-label-option ${selectedLabels.has(label) ? "issue-label-option-active" : ""}`}
            onClick={() => toggleLabel(label)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="modal-label">Description</label>
      <textarea
        className="modal-input modal-textarea"
        placeholder="Issue description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={10}
      />
      {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
      <div className="modal-actions">
        <button
          className="wt-btn wt-btn-add"
          onClick={handleSubmit}
          disabled={!title.trim() || mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <span className="spinner" /> {mode === "create" ? "Creating..." : "Saving..."}
            </>
          ) : mode === "create" ? (
            "Create"
          ) : (
            "Save"
          )}
        </button>
        <span className="modal-shortcut-hint">Cmd+Enter</span>
        <button className="wt-btn wt-btn-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
