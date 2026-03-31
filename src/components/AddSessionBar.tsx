import { useState, useImperativeHandle, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session, GitHubPr } from "../types";
import type { PendingCreation, CreateSessionParams } from "../hooks/useSessionCreation";
import { isMainSession, validateBranchName } from "../utils";
import { queryKeys } from "../queryKeys";

export interface AddSessionBarHandle {
  toggleForm: () => void;
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
  backend: "local" | "opencode-remote" | "claude-remote";
  createSession: (params: CreateSessionParams) => void;
  pendingCreations: Map<string, PendingCreation>;
  onCreateRemoteSession?: (title: string, prompt: string | null) => void;
  liveTmuxSessions?: Set<string>;
}

type SessionMode = "worktree" | "plain" | "from-pr";
type SessionTool = "claude" | "opencode" | "shell";

function PrPicker({ repoPath, onSelect }: { repoPath: string; onSelect: (pr: GitHubPr) => void }) {
  const [filter, setFilter] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: allPrs = [], isLoading } = useQuery({
    queryKey: queryKeys.openPrs(repoPath),
    queryFn: () => invoke<GitHubPr[]>("list_open_prs", { repoPath }),
    staleTime: 30_000,
  });

  const filtered = allPrs.filter((pr) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    // Allow searching by PR number (with or without #)
    const numStr = String(pr.number);
    if (numStr === q || numStr === q.replace("#", "")) return true;
    return (
      pr.title.toLowerCase().includes(q) ||
      pr.branch.toLowerCase().includes(q) ||
      pr.author.toLowerCase().includes(q)
    );
  });

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
    <div className="component-input-wrapper">
      <input
        ref={inputRef}
        className="wt-input"
        type="text"
        placeholder={isLoading ? "Loading PRs..." : "Search PRs by #, title, branch, or author..."}
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
        disabled={isLoading}
        spellCheck={false}
        autoCapitalize="off"
        autoFocus
      />
      {showDropdown && filtered.length > 0 && (
        <div ref={dropdownRef} className="component-dropdown pr-dropdown">
          {filtered.slice(0, 30).map((pr) => (
            <button
              key={pr.number}
              type="button"
              className="component-dropdown-item pr-dropdown-item"
              onClick={() => {
                onSelect(pr);
                setFilter("");
                setShowDropdown(false);
              }}
            >
              <span className="pr-number">#{pr.number}</span>
              <span className="pr-title">{pr.title}</span>
              <span className="pr-meta">
                {pr.branch} &middot; {pr.author}
              </span>
            </button>
          ))}
          {filtered.length > 30 && (
            <div className="component-dropdown-more">{filtered.length - 30} more...</div>
          )}
          {filtered.length === 0 && !isLoading && (
            <div className="component-dropdown-more">No matching PRs</div>
          )}
        </div>
      )}
      {showDropdown && !isLoading && allPrs.length === 0 && (
        <div ref={dropdownRef} className="component-dropdown">
          <div className="component-dropdown-more">No open PRs found</div>
        </div>
      )}
    </div>
  );
}

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
  backend,
  createSession,
  pendingCreations,
  onCreateRemoteSession,
  liveTmuxSessions,
}: AddSessionBarProps) {
  const queryClient = useQueryClient();
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
  const [selectedPr, setSelectedPr] = useState<GitHubPr | null>(null);
  const [restartingAll, setRestartingAll] = useState(false);

  const hasMainSession = sessions.some((s) => isMainSession(s.worktree_branch));

  // Count dead sessions for the restart all button
  const deadSessionCount = sessions.filter(
    (s) => s.tmux_session && liveTmuxSessions && !liveTmuxSessions.has(s.tmux_session),
  ).length;

  const handleRestartAll = useCallback(async () => {
    setRestartingAll(true);
    try {
      await invoke("restart_all_sessions", { groupPath, resume: true });
      // Give sessions time to start, then refresh
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
        setRestartingAll(false);
      }, 2000);
    } catch (err) {
      console.error("Restart all failed:", err);
      setRestartingAll(false);
    }
  }, [groupPath, queryClient]);
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
    setSelectedPr(null);
    setShowForm(false);
  };

  const deriveTitle = (fallback: string) => {
    if (title.trim()) return title.trim();
    if (prompt.trim()) return prompt.trim().slice(0, 80);
    return fallback;
  };

  const isRemote = backend === "opencode-remote" || backend === "claude-remote";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const promptValue = prompt.trim() || null;

    if (isRemote) {
      onCreateRemoteSession?.(deriveTitle("session"), promptValue);
      resetForm();
      return;
    }

    if (mode === "from-pr") {
      if (!selectedPr) return;
      createSession({
        projectPath: repoPath,
        group: groupPath,
        title: deriveTitle(`PR #${selectedPr.number}: ${selectedPr.title}`),
        tool,
        worktreeBranch: selectedPr.branch,
        newBranch: false,
        start: true,
        prompt: promptValue,
        prNumber: selectedPr.number,
        prUrl: selectedPr.url,
      });
    } else if (mode === "worktree") {
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
          {!isRemote && deadSessionCount > 0 && (
            <button
              className="wt-btn wt-btn-action"
              onClick={handleRestartAll}
              disabled={restartingAll}
              title={`Restart ${deadSessionCount} dead session${deadSessionCount === 1 ? "" : "s"} and resume Claude conversations`}
            >
              {restartingAll ? "Restarting..." : `Restart All (${deadSessionCount})`}
            </button>
          )}
          {!isRemote && isGitRepo && !hasMainSession && (
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
            {!isRemote && isGitRepo && (
              <div className="add-session-mode-toggle">
                <button
                  type="button"
                  className={`mode-btn ${mode === "worktree" ? "mode-btn-active" : ""}`}
                  onClick={() => setMode("worktree")}
                >
                  New Branch
                </button>
                <button
                  type="button"
                  className={`mode-btn ${mode === "from-pr" ? "mode-btn-active" : ""}`}
                  onClick={() => setMode("from-pr")}
                >
                  From PR
                </button>
                <button
                  type="button"
                  className={`mode-btn ${mode === "plain" ? "mode-btn-active" : ""}`}
                  onClick={() => setMode("plain")}
                >
                  No Worktree
                </button>
              </div>
            )}
            {!isRemote && (
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
                  className={`mode-btn ${tool === "opencode" ? "mode-btn-active" : ""}`}
                  onClick={() => setTool("opencode")}
                >
                  Opencode
                </button>
                <button
                  type="button"
                  className={`mode-btn ${tool === "shell" ? "mode-btn-active" : ""}`}
                  onClick={() => setTool("shell")}
                >
                  Shell
                </button>
              </div>
            )}
          </div>
          <div className="add-session-fields">
            {!isRemote && mode === "from-pr" && (
              <>
                {selectedPr ? (
                  <div className="pr-selected">
                    <span className="pr-selected-info">
                      <span className="pr-number">#{selectedPr.number}</span> {selectedPr.title}
                      <span className="pr-meta"> ({selectedPr.branch})</span>
                    </span>
                    <button
                      type="button"
                      className="component-chip-remove"
                      onClick={() => setSelectedPr(null)}
                      aria-label="Clear PR selection"
                    >
                      x
                    </button>
                  </div>
                ) : (
                  <PrPicker repoPath={repoPath} onSelect={(pr) => setSelectedPr(pr)} />
                )}
              </>
            )}
            {!isRemote && mode === "worktree" && (
              <>
                <input
                  className={`wt-input${branchError ? " wt-input-error" : ""}`}
                  type="text"
                  placeholder="branch-name"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value.replace(/ /g, "-"))}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoFocus
                />
                {branchError && <div className="wt-error wt-error-inline">{branchError}</div>}
              </>
            )}
            {!isRemote && needsComponent && showForm && (
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
                isRemote
                  ? "title (defaults to prompt)"
                  : mode === "worktree"
                    ? "title (defaults to branch name or prompt)"
                    : "title (defaults to prompt)"
              }
              value={title}
              onChange={(e) =>
                setTitle(isRemote ? e.target.value.replace(/ /g, "-") : e.target.value)
              }
              autoFocus={isRemote || mode === "plain"}
            />
          </div>
          {(isRemote || tool === "claude" || tool === "opencode") && (
            <textarea
              className="wt-input wt-prompt-input"
              placeholder="prompt (sent to AI at start)"
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
                !isRemote &&
                ((mode === "from-pr" && !selectedPr) ||
                  (mode === "worktree" && (!branchName.trim() || !!branchError)) ||
                  (needsComponent && selectedComponents.length === 0) ||
                  (mode === "plain" && !title.trim() && !prompt.trim()))
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
