import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type GroupMode = "existing" | "clone";

interface CreateGroupModalProps {
  onClose: () => void;
  onCreated?: (groupName: string) => void;
}

/** Extract a project name from a git URL (e.g. "https://github.com/foo/bar.git" -> "bar") */
function projectNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  return cleaned.split("/").pop() ?? "";
}

export function CreateGroupModal({ onClose, onCreated }: CreateGroupModalProps) {
  const [mode, setMode] = useState<GroupMode>("existing");
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [defaultPath, setDefaultPath] = useState("");
  const queryClient = useQueryClient();

  // Clone mode fields
  const [gitUrl, setGitUrl] = useState("");
  const [parentDir, setParentDir] = useState("~/repos");
  const [projectName, setProjectName] = useState("");
  const [projectNameManuallyEdited, setProjectNameManuallyEdited] = useState(false);

  const setPathAndDefaultName = (path: string) => {
    setDefaultPath(path);
    if (!nameManuallyEdited) {
      const basename = path.replace(/\/+$/, "").split("/").pop() ?? "";
      setName(basename);
    }
  };

  const setUrlAndDeriveNames = (url: string) => {
    setGitUrl(url);
    const derived = projectNameFromUrl(url);
    if (!projectNameManuallyEdited) {
      setProjectName(derived);
    }
    if (!nameManuallyEdited) {
      setName(derived);
    }
  };

  const setProjectNameAndDeriveName = (pName: string) => {
    setProjectName(pName);
    setProjectNameManuallyEdited(true);
    if (!nameManuallyEdited) {
      setName(pName);
    }
  };

  const existingMutation = useMutation({
    mutationFn: () =>
      invoke("create_group", {
        name: name.trim(),
        defaultPath: defaultPath.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onCreated?.(name.trim());
      onClose();
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      const repoPath = await invoke<string>("clone_bare_worktree_repo", {
        gitUrl: gitUrl.trim(),
        projectName: projectName.trim(),
        parentDir: parentDir.trim(),
      });
      await invoke("create_group", {
        name: name.trim(),
        defaultPath: repoPath,
      });
      // Auto-start a main session so the user doesn't have to
      await invoke("create_session", {
        projectPath: repoPath,
        group: repoPath,
        title: "main",
        tool: "claude",
        worktreeBranch: null,
        newBranch: false,
        start: true,
        prompt: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onCreated?.(name.trim());
      onClose();
    },
  });

  const mutation = mode === "clone" ? cloneMutation : existingMutation;

  const handleSubmit = () => {
    if (mode === "existing") {
      if (name.trim() && defaultPath.trim()) {
        existingMutation.mutate();
      }
    } else {
      if (name.trim() && gitUrl.trim() && projectName.trim() && parentDir.trim()) {
        cloneMutation.mutate();
      }
    }
  };

  const isValid =
    mode === "existing"
      ? !!(name.trim() && defaultPath.trim())
      : !!(name.trim() && gitUrl.trim() && projectName.trim() && parentDir.trim());

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Create Group</h3>
        <div className="add-session-mode-toggle" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`mode-btn ${mode === "existing" ? "mode-btn-active" : ""}`}
            onClick={() => setMode("existing")}
          >
            Existing Directory
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === "clone" ? "mode-btn-active" : ""}`}
            onClick={() => setMode("clone")}
          >
            Clone from URL
          </button>
        </div>

        {mode === "existing" ? (
          <>
            <label className="modal-label">Repo path</label>
            <div className="modal-input-row">
              <input
                className="modal-input modal-input-flex"
                type="text"
                placeholder="/Users/you/repos/my-project"
                value={defaultPath}
                onChange={(e) => setPathAndDefaultName(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <button
                className="wt-btn"
                type="button"
                onClick={async () => {
                  const selected = await open({
                    directory: true,
                    multiple: false,
                    title: "Select repo directory",
                  });
                  if (selected) {
                    setPathAndDefaultName(selected);
                  }
                }}
              >
                Browse
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="modal-label">Git URL</label>
            <input
              className="modal-input"
              type="text"
              placeholder="https://github.com/user/repo.git"
              value={gitUrl}
              onChange={(e) => setUrlAndDeriveNames(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <label className="modal-label">Parent directory</label>
            <div className="modal-input-row">
              <input
                className="modal-input modal-input-flex"
                type="text"
                placeholder="~/repos"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="wt-btn"
                type="button"
                onClick={async () => {
                  const selected = await open({
                    directory: true,
                    multiple: false,
                    title: "Select parent directory",
                  });
                  if (selected) {
                    setParentDir(selected);
                  }
                }}
              >
                Browse
              </button>
            </div>
            <label className="modal-label">Project name</label>
            <input
              className="modal-input"
              type="text"
              placeholder="my-project"
              value={projectName}
              onChange={(e) => setProjectNameAndDeriveName(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </>
        )}

        <label className="modal-label">Group name</label>
        <input
          className="modal-input"
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameManuallyEdited(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {mutation.isPending && mode === "clone" && (
          <div className="wt-hint">Cloning repository...</div>
        )}
        {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-add"
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending}
          >
            {mutation.isPending ? "Creating..." : "Create"}
          </button>
          <button className="wt-btn wt-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
