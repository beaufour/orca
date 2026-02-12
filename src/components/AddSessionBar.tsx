import { useState, useImperativeHandle, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";
import type { PendingCreation } from "../hooks/useSessionCreation";
import { isMainSession, validateBranchName } from "../utils";

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
  components?: string[];
}

interface AddSessionBarProps {
  ref?: React.Ref<AddSessionBarHandle>;
  repoPath: string;
  groupPath: string;
  groupName: string;
  sessions: Session[];
  isGitRepo: boolean;
  worktreeCommand: string | null;
  componentDepth: number;
  createSession: (params: CreateSessionParams) => void;
  pendingCreations: Map<string, PendingCreation>;
}

type SessionMode = "worktree" | "plain";
type SessionTool = "claude" | "shell";

function ComponentPicker({
  repoPath,
  depth,
  selected,
  onSelect,
  onRemove,
}: {
  repoPath: string;
  depth: number;
  selected: string[];
  onSelect: (component: string) => void;
  onRemove: (component: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: allComponents = [], isLoading } = useQuery({
    queryKey: ["components", repoPath, depth],
    queryFn: () => invoke<string[]>("list_components", { repoPath, depth }),
    staleTime: 60_000,
  });

  const filtered = allComponents.filter(
    (c) => c.toLowerCase().includes(filter.toLowerCase()) && !selected.includes(c),
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="component-picker">
      {selected.length > 0 && (
        <div className="component-chips">
          {selected.map((c) => (
            <span key={c} className="component-chip">
              {c}
              <button
                type="button"
                className="component-chip-remove"
                onClick={() => onRemove(c)}
                aria-label={`Remove ${c}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="component-input-wrapper">
        <input
          ref={inputRef}
          className="wt-input"
          type="text"
          placeholder={isLoading ? "Loading components..." : "Type to filter components..."}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          disabled={isLoading}
          spellCheck={false}
          autoCapitalize="off"
        />
        {showDropdown && filtered.length > 0 && (
          <div ref={dropdownRef} className="component-dropdown">
            {filtered.slice(0, 50).map((c) => (
              <button
                key={c}
                type="button"
                className="component-dropdown-item"
                onClick={() => {
                  onSelect(c);
                  setFilter("");
                  inputRef.current?.focus();
                }}
              >
                {c}
              </button>
            ))}
            {filtered.length > 50 && (
              <div className="component-dropdown-more">{filtered.length - 50} more...</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AddSessionBar({
  ref,
  repoPath,
  groupPath,
  groupName,
  sessions,
  isGitRepo,
  worktreeCommand,
  componentDepth,
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
  const [mode, setMode] = useState<SessionMode>(isGitRepo ? "worktree" : "plain");
  const [tool, setTool] = useState<SessionTool>("claude");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);

  const hasMainSession = sessions.some((s) => isMainSession(s.worktree_branch));
  const branchError = branchName.trim() ? validateBranchName(branchName.trim()) : null;
  const needsComponent = mode === "worktree" && !!worktreeCommand?.includes("{component}");

  const hasPending = Array.from(pendingCreations.values()).some(
    (p) => p.groupPath === groupPath && !p.error,
  );

  const resetForm = () => {
    setBranchName("");
    setTitle("");
    setPrompt("");
    setMode(isGitRepo ? "worktree" : "plain");
    setTool("claude");
    setSelectedComponents([]);
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
      if (!branchName.trim() || branchError) return;
      if (needsComponent && selectedComponents.length === 0) return;
      createSession({
        projectPath: repoPath,
        group: groupPath,
        title: deriveTitle(branchName.trim()),
        tool,
        worktreeBranch: branchName.trim(),
        newBranch: true,
        start: true,
        prompt: promptValue,
        components: needsComponent ? selectedComponents : undefined,
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
          {isGitRepo && !hasMainSession && (
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
            {isGitRepo && (
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
            )}
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
              <>
                <input
                  className={`wt-input${branchError ? " wt-input-error" : ""}`}
                  type="text"
                  placeholder="branch-name"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoFocus
                />
                {branchError && <div className="wt-error wt-error-inline">{branchError}</div>}
              </>
            )}
            {needsComponent && showForm && (
              <ComponentPicker
                repoPath={repoPath}
                depth={componentDepth}
                selected={selectedComponents}
                onSelect={(c) => setSelectedComponents((prev) => [...prev, c])}
                onRemove={(c) => setSelectedComponents((prev) => prev.filter((x) => x !== c))}
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
                (mode === "worktree" && (!branchName.trim() || !!branchError)) ||
                (needsComponent && selectedComponents.length === 0) ||
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
