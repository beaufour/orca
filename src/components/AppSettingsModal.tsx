import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { storageGet, storageSet, SCROLL_SPEED_KEY, SCROLL_SPEED_DEFAULT } from "../utils";
import { setAnalyticsEnabled } from "../analytics";

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps) {
  const [scrollSpeed, setScrollSpeed] = useState(() => {
    const stored = storageGet(SCROLL_SPEED_KEY);
    return stored ? parseFloat(stored) : SCROLL_SPEED_DEFAULT;
  });

  const [analyticsEnabled, setAnalyticsEnabledState] = useState(false);

  useEffect(() => {
    invoke<boolean>("get_analytics_enabled")
      .then(setAnalyticsEnabledState)
      .catch((err) => console.warn("Failed to get analytics preference:", err));
  }, []);

  const handleScrollSpeedChange = (value: number) => {
    setScrollSpeed(value);
    storageSet(SCROLL_SPEED_KEY, value.toString());
  };

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabledState(enabled);
    setAnalyticsEnabled(enabled);
    invoke("set_analytics_enabled", { enabled }).catch((err) => {
      console.warn("Failed to save analytics preference:", err);
    });
  };

  const handleReset = () => {
    handleScrollSpeedChange(SCROLL_SPEED_DEFAULT);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
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
              Help improve Orca by sharing anonymous usage data
            </span>
          </label>
          <p className="settings-toggle-description">
            Anonymous usage statistics to help improve Orca. No personal data is sent.{" "}
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

        <div className="modal-actions">
          <button className="wt-btn" onClick={handleReset}>
            Reset to defaults
          </button>
          <button className="wt-btn wt-btn-add" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
