import { useState, useImperativeHandle } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";

export interface AddSessionBarHandle {
  toggleForm: () => void;
}

interface AddSessionBarProps {
  ref?: React.Ref<AddSessionBarHandle>;
  repoPath: string;
  groupPath: string;
  groupName: string;
  sessions: Session[];
}

type SessionMode = "worktree" | "plain";
type SessionTool = "claude" | "shell";

export function AddSessionBar({
  ref,
  repoPath,
  groupPath,
  groupName,
  sessions,
}: AddSessionBarProps) {
  useImperativeHandle(ref, () => ({
    toggleForm: () => setShowForm((prev) => !prev),
  }));
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<SessionMode>("worktree");
  const [tool, setTool] = useState<SessionTool>("claude");

  const hasMainSession = sessions.some(
    (s) =>
      !s.worktree_branch ||
      s.worktree_branch === "main" ||
      s.worktree_branch === "master",
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const createMutation = useMutation({
    mutationFn: (params: {
      title: string;
      tool: string;
      worktreeBranch: string | null;
      newBranch: boolean;
    }) =>
      invoke("create_session", {
        projectPath: repoPath,
        group: groupPath,
        title: params.title,
        tool: params.tool,
        worktreeBranch: params.worktreeBranch,
        newBranch: params.newBranch,
      }),
    onSuccess: () => {
      invalidate();
      resetForm();
    },
  });

  const resetForm = () => {
    setBranchName("");
    setTitle("");
    setMode("worktree");
    setTool("claude");
    setShowForm(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "worktree") {
      if (!branchName.trim()) return;
      createMutation.mutate({
        title: title.trim() || branchName.trim(),
        tool,
        worktreeBranch: branchName.trim(),
        newBranch: true,
      });
    } else {
      createMutation.mutate({
        title: title.trim() || "session",
        tool,
        worktreeBranch: null,
        newBranch: false,
      });
    }
  };

  const handleStartMain = () => {
    createMutation.mutate({
      title: "main",
      tool: "claude",
      worktreeBranch: null,
      newBranch: false,
    });
  };

  return (
    <div className="add-session-bar">
      <div className="add-session-header">
        <span className="add-session-group-name">{groupName}</span>
        <div className="add-session-buttons">
          {!hasMainSession && (
            <button
              className="wt-btn wt-btn-main"
              onClick={handleStartMain}
              disabled={createMutation.isPending}
              title="Start a session on the main branch"
            >
              + Main Session
            </button>
          )}
          <button
            className="wt-btn wt-btn-add"
            onClick={() => setShowForm(!showForm)}
            disabled={createMutation.isPending}
          >
            + Add Session
          </button>
        </div>
      </div>

      {showForm && (
        <form className="add-session-form" onSubmit={handleSubmit}>
          <div className="add-session-toggles">
            <div className="add-session-mode-toggle">
              <button
                type="button"
                className={`mode-btn ${mode === "worktree" ? "mode-btn-active" : ""}`}
                onClick={() => setMode("worktree")}
              >
                With Worktree
              </button>
              <button
                type="button"
                className={`mode-btn ${mode === "plain" ? "mode-btn-active" : ""}`}
                onClick={() => setMode("plain")}
              >
                Without Worktree
              </button>
            </div>
            <div className="add-session-mode-toggle">
              <button
                type="button"
                className={`mode-btn ${tool === "claude" ? "mode-btn-active" : ""}`}
                onClick={() => setTool("claude")}
              >
                Claude
              </button>
              <button
                type="button"
                className={`mode-btn ${tool === "shell" ? "mode-btn-active" : ""}`}
                onClick={() => setTool("shell")}
              >
                Shell
              </button>
            </div>
          </div>
          <div className="add-session-fields">
            {mode === "worktree" && (
              <input
                className="wt-input"
                type="text"
                placeholder="branch-name"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoFocus
              />
            )}
            <input
              className="wt-input"
              type="text"
              placeholder={
                mode === "worktree"
                  ? "title (defaults to branch name)"
                  : "session title"
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={mode === "plain"}
            />
            <button
              className="wt-btn wt-btn-confirm"
              type="submit"
              disabled={
                createMutation.isPending ||
                (mode === "worktree" && !branchName.trim()) ||
                (mode === "plain" && !title.trim())
              }
            >
              Create
            </button>
            <button
              className="wt-btn wt-btn-cancel"
              type="button"
              onClick={resetForm}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {createMutation.error && (
        <div className="wt-error">{String(createMutation.error)}</div>
      )}
    </div>
  );
}
