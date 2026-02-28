import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { setAnalyticsEnabled } from "../analytics";
import logoSrc from "../assets/logo.png";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState("");
  useEscapeKey(onClose);
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion);
    invoke<boolean>("get_analytics_enabled")
      .then((enabled) => {
        setAnalyticsEnabledState(enabled);
        setAnalyticsLoaded(true);
      })
      .catch((err) => {
        console.warn("Failed to get analytics preference:", err);
        setAnalyticsLoaded(true);
      });
  }, []);

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabledState(enabled);
    setAnalyticsEnabled(enabled);
    invoke("set_analytics_enabled", { enabled }).catch((err) => {
      console.warn("Failed to save analytics preference:", err);
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content about-dialog" onClick={(e) => e.stopPropagation()}>
        <img src={logoSrc} alt="Orca" className="about-logo" />
        <h3 className="about-title">Orca</h3>
        {version && <p className="about-version">v{version}</p>}
        <p className="about-desc">
          Manage parallel Claude Code sessions across repos and git worktrees.
        </p>
        <a
          className="about-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openUrl("https://github.com/beaufour/orca");
          }}
        >
          github.com/beaufour/orca
        </a>
        {analyticsLoaded && (
          <div className="about-analytics">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => handleAnalyticsToggle(e.target.checked)}
              />
              <span className="settings-toggle-label">
                Help improve Orca by sharing anonymous usage data
              </span>
            </label>
            <p className="settings-toggle-description">
              We collect anonymous usage statistics to improve Orca. No personal data is sent.{" "}
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
        )}
        <div className="about-hint">Press Esc to close</div>
      </div>
    </div>
  );
}
