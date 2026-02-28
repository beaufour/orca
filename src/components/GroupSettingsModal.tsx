import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group, Session } from "../types";
import { queryKeys } from "../queryKeys";
import { Modal } from "./Modal";

interface GroupSettingsModalProps {
  group: Group;
  onClose: () => void;
  onGroupDeleted: () => void;
}

export function GroupSettingsModal({ group, onClose, onGroupDeleted }: GroupSettingsModalProps) {
  const [githubIssuesEnabled, setGithubIssuesEnabled] = useState(group.github_issues_enabled);
  const [mergeWorkflow, setMergeWorkflow] = useState(group.merge_workflow);
  const [worktreeCommand, setWorktreeCommand] = useState(group.worktree_command ?? "");
  const [componentDepth, setComponentDepth] = useState(group.component_depth);
  const [backend, setBackend] = useState<"local" | "opencode-remote" | "claude-remote">(
    group.backend,
  );
  const [serverUrl, setServerUrl] = useState(group.server_url ?? "");
  const [serverPassword, setServerPassword] = useState("");
  const isRemoteBackend = backend === "opencode-remote" || backend === "claude-remote";
  const [passwordLoaded, setPasswordLoaded] = useState(
    group.backend !== "opencode-remote" && group.backend !== "claude-remote",
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  // Fetch global remote settings
  const [globalUrl, setGlobalUrl] = useState<string>("");
  const [globalToken, setGlobalToken] = useState<string>("");
  useEffect(() => {
    invoke<string | null>("get_remote_server_url")
      .then((url) => setGlobalUrl(url ?? ""))
      .catch(() => {});
    invoke<string | null>("get_remote_auth_token")
      .then((token) => setGlobalToken(token ?? ""))
      .catch(() => {});
  }, []);

  const hasGlobalToken = globalToken.length > 0;
  const showRemoteOptions = hasGlobalToken || group.backend !== "local";

  // Fetch session count for this group
  const { data: sessions } = useQuery<Session[]>({
    queryKey: queryKeys.sessions(group.path),
    queryFn: () => invoke("get_sessions", { groupPath: group.path }),
  });
  const sessionCount = sessions?.length ?? 0;

  // Load the server password/token (not stored in Group for security)
  useEffect(() => {
    if (group.backend === "opencode-remote" || group.backend === "claude-remote") {
      invoke<string | null>("get_server_password", { groupPath: group.path })
        .then((pw) => {
          if (pw) setServerPassword(pw);
          setPasswordLoaded(true);
        })
        .catch(() => setPasswordLoaded(true));
    }
  }, [group.path, group.backend]);

  const hasComponentPlaceholder = worktreeCommand.includes("{component}");

  const mutation = useMutation({
    mutationFn: () =>
      invoke("update_group_settings", {
        groupPath: group.path,
        githubIssuesEnabled: githubIssuesEnabled,
        mergeWorkflow: mergeWorkflow,
        worktreeCommand: worktreeCommand.trim() || null,
        componentDepth: componentDepth,
        backend: backend,
        serverUrl: serverUrl.trim() || null,
        serverPassword: serverPassword || null,
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
                backend: backend,
                server_url: serverUrl.trim() || null,
              }
            : g,
        ),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => invoke<number>("delete_group", { groupPath: group.path }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      onGroupDeleted();
    },
  });

  const isDirty =
    githubIssuesEnabled !== group.github_issues_enabled ||
    mergeWorkflow !== group.merge_workflow ||
    (worktreeCommand.trim() || null) !== (group.worktree_command ?? null) ||
    componentDepth !== group.component_depth ||
    backend !== group.backend ||
    (serverUrl.trim() || null) !== (group.server_url ?? null) ||
    (passwordLoaded && serverPassword !== "");

  const handleSubmit = () => {
    if (!isDirty) {
      onClose();
      return;
    }
    mutation.mutate();
  };

  if (confirmingDelete) {
    return (
      <Modal onClose={() => setConfirmingDelete(false)}>
        <h3 className="modal-title">Delete Group: {group.name}</h3>
        <p className="settings-toggle-description" style={{ marginBottom: 12 }}>
          This will{" "}
          <strong>
            stop and remove {sessionCount === 1 ? "1 session" : `all ${sessionCount} sessions`}
          </strong>{" "}
          in this group.
        </p>
        <p className="settings-toggle-description" style={{ marginBottom: 12 }}>
          Files and directories on disk will <strong>not</strong> be removed.
        </p>
        {deleteMutation.error && <div className="wt-error">{String(deleteMutation.error)}</div>}
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-danger"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete Group"}
          </button>
          <button
            className="wt-btn wt-btn-cancel"
            onClick={() => setConfirmingDelete(false)}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="modal-title">Settings: {group.name}</h3>
      <p className="settings-base-path" title={group.default_path}>
        {group.default_path}
      </p>
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
      <div className="settings-radio-group">
        <span className="settings-radio-label">Backend</span>
        <label className="settings-radio-option">
          <input
            type="radio"
            name="backend"
            value="local"
            checked={backend === "local"}
            onChange={() => setBackend("local")}
          />
          <span className="settings-radio-text">
            <strong>Local</strong> — agent-deck + tmux (Claude, OpenCode, Shell)
          </span>
        </label>
        {showRemoteOptions && (
          <>
            <label className="settings-radio-option">
              <input
                type="radio"
                name="backend"
                value="opencode-remote"
                checked={backend === "opencode-remote"}
                onChange={() => setBackend("opencode-remote")}
              />
              <span className="settings-radio-text">
                <strong>OpenCode Remote</strong> — connect to remote OpenCode server
              </span>
            </label>
            <label className="settings-radio-option">
              <input
                type="radio"
                name="backend"
                value="claude-remote"
                checked={backend === "claude-remote"}
                onChange={() => setBackend("claude-remote")}
              />
              <span className="settings-radio-text">
                <strong>Claude Code Remote</strong> — connect to remote Claude Code via AgentAPI
              </span>
            </label>
          </>
        )}
      </div>
      {isRemoteBackend && (
        <div className="settings-section">
          <label className="modal-label">Server URL</label>
          <input
            className="wt-input"
            type="text"
            placeholder={
              globalUrl ||
              (backend === "claude-remote"
                ? "https://agent-remote.example.workers.dev/claude/project-id"
                : "https://your-worker.workers.dev")
            }
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            spellCheck={false}
          />
          {globalUrl && !serverUrl.trim() && (
            <span className="settings-hint">Using global default</span>
          )}
          <label className="modal-label" style={{ marginTop: 8 }}>
            {backend === "claude-remote" ? "Token" : "Password"}
          </label>
          <input
            className="wt-input"
            type="password"
            placeholder={
              passwordLoaded
                ? globalToken
                  ? "Using global default"
                  : backend === "claude-remote"
                    ? "Enter token"
                    : "Enter password"
                : "Loading..."
            }
            value={serverPassword}
            onChange={(e) => setServerPassword(e.target.value)}
            spellCheck={false}
          />
          {globalToken && !serverPassword && passwordLoaded && (
            <span className="settings-hint">Using global default</span>
          )}
          {(serverUrl.trim() || serverPassword) && (
            <button
              className="wt-btn"
              style={{ marginTop: 8, alignSelf: "flex-start" }}
              type="button"
              onClick={() => {
                setServerUrl("");
                setServerPassword("");
              }}
            >
              Reset to global defaults
            </button>
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
      <div className="settings-delete-section">
        <button className="wt-btn wt-btn-danger" onClick={() => setConfirmingDelete(true)}>
          Delete Group...
        </button>
      </div>
    </Modal>
  );
}
