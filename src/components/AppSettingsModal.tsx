import { useState } from "react";
import { storageGet, storageSet, SCROLL_SPEED_KEY, SCROLL_SPEED_DEFAULT } from "../utils";

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps) {
  const [scrollSpeed, setScrollSpeed] = useState(() => {
    const stored = storageGet(SCROLL_SPEED_KEY);
    return stored ? parseFloat(stored) : SCROLL_SPEED_DEFAULT;
  });

  const handleScrollSpeedChange = (value: number) => {
    setScrollSpeed(value);
    storageSet(SCROLL_SPEED_KEY, value.toString());
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
            max="3.0"
            step="0.1"
            value={scrollSpeed}
            onChange={(e) => handleScrollSpeedChange(parseFloat(e.target.value))}
          />
          <div className="app-settings-range-labels">
            <span>Slow</span>
            <span>Fast</span>
          </div>
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
