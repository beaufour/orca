import { useState, useImperativeHandle } from "react";
import type { Session } from "../types";
import type { PendingCreation } from "../hooks/useSessionCreation";

export interface AddSessionBarHandle {
  toggleForm: () => void;
}

interface CreateSessionParams {
  projectPath: string;
  group: string;
  title: string;
  tool?: string;
  worktreeBranch?: string | null;
  newBranch?: boolean;
  start?: boolean;
  prompt?: string | null;
}

interface AddSessionBarProps {
  ref?: React.Ref<AddSessionBarHandle>;
  repoPath: string;
  groupPath: string;
  groupName: string;
  sessions: Session[];
  createSession: (params: CreateSessionParams) => void;
  pendingCreations: Map<string, PendingCreation>;
}

type SessionMode = "worktree" | "plain";
type SessionTool = "claude" | "shell";

export function AddSessionBar({
  ref,
  repoPath,
  groupPath,
  groupName,
  sessions,
  createSession,
  pendingCreations,
}: AddSessionBarProps) {
  const [showForm, setShowForm] = useState(false);
  useImperativeHandle(ref, () => ({
    toggleForm: () => setShowForm((prev) => !prev),
  }));
  const [branchName, setBranchName] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<SessionMode>("worktree");
  const [tool, setTool] = useState<SessionTool>("claude");

  const hasMainSession = sessions.some(
    (s) => !s.worktree_branch || s.worktree_branch === "main" || s.worktree_branch === "master",
  );

  const hasPending = Array.from(pendingCreations.values()).some(
    (p) => p.groupPath === groupPath && !p.error,
  );

  const resetForm = () => {
    setBranchName("");
    setTitle("");
    setPrompt("");
    setMode("worktree");
    setTool("claude");
    setShowForm(false);
  };

  const deriveTitle = (fallback: string) => {
    if (title.trim()) return title.trim();
    if (prompt.trim()) return prompt.trim().slice(0, 80);
    return fallback;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const promptValue = prompt.trim() || null;
    if (mode === "worktree") {
      if (!branchName.trim()) return;
      createSession({
        projectPath: repoPath,
        group: groupPath,
        title: deriveTitle(branchName.trim()),
        tool,
        worktreeBranch: branchName.trim(),
        newBranch: true,
        start: true,
        prompt: promptValue,
      });
    } else {
      createSession({
        projectPath: repoPath,
        group: groupPath,
        title: deriveTitle("session"),
        tool,
        worktreeBranch: null,
        newBranch: false,
        start: true,
        prompt: promptValue,
      });
    }
    resetForm();
  };

  const handleStartMain = () => {
    createSession({
      projectPath: repoPath,
      group: groupPath,
      title: "main",
      tool: "claude",
      worktreeBranch: null,
      newBranch: false,
      start: true,
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
              disabled={hasPending}
              title="Start a session on the main branch"
            >
              + Main Session
            </button>
          )}
          {!showForm && (
            <button
              className="wt-btn wt-btn-add"
              onClick={() => setShowForm(!showForm)}
              disabled={hasPending}
            >
              + Add Session
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form
          className="add-session-form"
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        >
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
                  ? "title (defaults to branch name or prompt)"
                  : "title (defaults to prompt)"
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={mode === "plain"}
            />
          </div>
          {tool === "claude" && (
            <textarea
              className="wt-input wt-prompt-input"
              placeholder="prompt (sent to Claude at start)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
          )}
          <div className="add-session-actions">
            <button
              className="wt-btn wt-btn-confirm"
              type="submit"
              disabled={
                (mode === "worktree" && !branchName.trim()) ||
                (mode === "plain" && !title.trim() && !prompt.trim())
              }
            >
              Create
            </button>
            <button className="wt-btn wt-btn-cancel" type="button" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
