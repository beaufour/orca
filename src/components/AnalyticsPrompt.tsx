import { invoke } from "@tauri-apps/api/core";
import { setAnalyticsEnabled } from "../analytics";
import { Modal } from "./Modal";

interface AnalyticsPromptProps {
  onClose: () => void;
}

export function AnalyticsPrompt({ onClose }: AnalyticsPromptProps) {
  const handleChoice = (enabled: boolean) => {
    setAnalyticsEnabled(enabled);
    invoke("set_analytics_enabled", { enabled }).catch((err) => {
      console.warn("Failed to save analytics preference:", err);
    });
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="modal-title">Help Improve Orca</h3>
      <p className="version-warning-text">
        Would you like to share anonymous usage statistics? This helps us understand which features
        are used and improve Orca.
      </p>
      <p className="version-warning-text" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
        No personal data is collected. You can change this anytime in App Settings.
      </p>
      <div className="modal-actions">
        <button className="wt-btn" onClick={() => handleChoice(false)}>
          No Thanks
        </button>
        <button className="wt-btn wt-btn-add" onClick={() => handleChoice(true)}>
          Enable Analytics
        </button>
      </div>
    </Modal>
  );
}
