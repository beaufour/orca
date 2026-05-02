import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { storageGet, storageSet, SCROLL_SPEED_KEY, SCROLL_SPEED_DEFAULT } from "../utils";
import { setAnalyticsEnabled } from "../analytics";
import { setSentryEnabled } from "../sentry";
import { queryKeys } from "../queryKeys";
import type { HookStatus } from "../types";
import { Modal } from "./Modal";

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps) {
  const queryClient = useQueryClient();
  const [scrollSpeed, setScrollSpeed] = useState(() => {
    const stored = storageGet(SCROLL_SPEED_KEY);
    return stored ? parseFloat(stored) : SCROLL_SPEED_DEFAULT;
  });

  const [analyticsEnabled, setAnalyticsEnabledState] = useState(false);
  const [remoteServerUrl, setRemoteServerUrl] = useState("");
  const [remoteAuthToken, setRemoteAuthToken] = useState("");
  const [initialRemoteUrl, setInitialRemoteUrl] = useState("");
  const [initialRemoteToken, setInitialRemoteToken] = useState("");
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [hookBusy, setHookBusy] = useState(false);
  const [hookError, setHookError] = useState<string | null>(null);

  const refreshHookStatus = () => {
    invoke<HookStatus>("get_claude_hooks_status")
      .then(setHookStatus)
      .catch((err) => console.warn("Failed to get hook status:", err));
  };

  useEffect(() => {
    invoke<boolean>("get_analytics_enabled")
      .then(setAnalyticsEnabledState)
      .catch((err) => console.warn("Failed to get analytics preference:", err));
    invoke<string | null>("get_remote_server_url")
      .then((url) => {
        const val = url ?? "";
        setRemoteServerUrl(val);
        setInitialRemoteUrl(val);
      })
      .catch((err) => console.warn("Failed to get remote server URL:", err));
    invoke<string | null>("get_remote_auth_token")
      .then((token) => {
        const val = token ?? "";
        setRemoteAuthToken(val);
        setInitialRemoteToken(val);
      })
      .catch((err) => console.warn("Failed to get remote auth token:", err));
    refreshHookStatus();
  }, []);

  const handleInstallHooks = async () => {
    setHookBusy(true);
    setHookError(null);
    try {
      const status = await invoke<HookStatus>("install_claude_hooks");
      setHookStatus(status);
    } catch (e) {
      setHookError(typeof e === "string" ? e : String(e));
    } finally {
      setHookBusy(false);
    }
  };

  const handleUninstallHooks = async () => {
    setHookBusy(true);
    setHookError(null);
    try {
      const status = await invoke<HookStatus>("uninstall_claude_hooks");
      setHookStatus(status);
    } catch (e) {
      setHookError(typeof e === "string" ? e : String(e));
    } finally {
      setHookBusy(false);
    }
  };

  const handleScrollSpeedChange = (value: number) => {
    setScrollSpeed(value);
    storageSet(SCROLL_SPEED_KEY, value.toString());
  };

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabledState(enabled);
    setAnalyticsEnabled(enabled);
    setSentryEnabled(enabled);
    invoke("set_analytics_enabled", { enabled }).catch((err) => {
      console.warn("Failed to save analytics preference:", err);
    });
  };

  const handleReset = () => {
    handleScrollSpeedChange(SCROLL_SPEED_DEFAULT);
  };

  const handleClose = () => {
    // Save remote settings if changed
    if (remoteServerUrl !== initialRemoteUrl) {
      invoke("set_remote_server_url", { url: remoteServerUrl.trim() || null }).catch((err) =>
        console.warn("Failed to save remote server URL:", err),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.globalRemoteUrl });
    }
    if (remoteAuthToken !== initialRemoteToken) {
      invoke("set_remote_auth_token", { token: remoteAuthToken || null }).catch((err) =>
        console.warn("Failed to save remote auth token:", err),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.globalRemoteToken });
    }
    onClose();
  };

  return (
    <Modal onClose={handleClose}>
      <h3>App Settings</h3>

      <div className="app-settings-field">
        <label className="app-settings-label">
          Scroll Speed
          <span className="app-settings-value">{scrollSpeed.toFixed(1)}</span>
        </label>
        <input
          type="range"
          className="app-settings-range"
          min="0.1"
          max="10.0"
          step="0.1"
          value={scrollSpeed}
          onChange={(e) => handleScrollSpeedChange(parseFloat(e.target.value))}
        />
        <div className="app-settings-range-labels">
          <span>Slow</span>
          <span>Fast</span>
        </div>
      </div>

      <div className="app-settings-field">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={analyticsEnabled}
            onChange={(e) => handleAnalyticsToggle(e.target.checked)}
          />
          <span className="settings-toggle-label">
            Help improve Orca by sharing anonymous usage data and crash reports
          </span>
        </label>
        <p className="settings-toggle-description">
          Anonymous usage statistics and crash reports to help improve Orca. No personal data is
          sent.{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              openUrl("https://posthog.com/privacy");
            }}
          >
            Learn more
          </a>
        </p>
      </div>

      <div className="app-settings-field">
        <label className="app-settings-label">Remote Server</label>
        <p className="settings-toggle-description" style={{ marginTop: 0 }}>
          Global URL and auth token for remote backends (OpenCode Remote, Claude Remote). Can be
          overridden per-group.
        </p>
        <label className="modal-label">Server URL</label>
        <input
          className="wt-input"
          type="text"
          placeholder="https://agent-remote.example.workers.dev"
          value={remoteServerUrl}
          onChange={(e) => setRemoteServerUrl(e.target.value)}
          spellCheck={false}
        />
        <label className="modal-label" style={{ marginTop: 8 }}>
          Auth Token
        </label>
        <input
          className="wt-input"
          type="password"
          placeholder="Enter token"
          value={remoteAuthToken}
          onChange={(e) => setRemoteAuthToken(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="app-settings-field">
        <label className="app-settings-label">Claude Code Hooks</label>
        <p className="settings-toggle-description" style={{ marginTop: 0 }}>
          When installed, Claude Code notifies Orca the moment a session is waiting on you
          (permission prompts, end of turn, etc.) instead of Orca having to guess from log files.
        </p>
        {hookStatus && (
          <p
            className="settings-toggle-description"
            style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "12px" }}
          >
            Status: {hookStatus.installed ? "installed" : "not installed"} ·{" "}
            {hookStatus.tracked_session_count} sessions tracked
            {hookStatus.last_event_age_secs !== null && (
              <> · last event {hookStatus.last_event_age_secs}s ago</>
            )}
          </p>
        )}
        {hookError && (
          <p
            className="settings-toggle-description"
            style={{ marginTop: 4, color: "var(--accent-error)" }}
          >
            {hookError}
          </p>
        )}
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          {hookStatus?.installed ? (
            <button className="wt-btn" onClick={handleUninstallHooks} disabled={hookBusy}>
              {hookBusy ? "Working…" : "Uninstall"}
            </button>
          ) : (
            <button className="wt-btn wt-btn-add" onClick={handleInstallHooks} disabled={hookBusy}>
              {hookBusy ? "Installing…" : "Install"}
            </button>
          )}
        </div>
      </div>

      <div className="modal-actions">
        <button className="wt-btn" onClick={handleReset}>
          Reset to defaults
        </button>
        <button className="wt-btn wt-btn-add" onClick={handleClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
