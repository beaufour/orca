import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { storageSet } from "../utils";

const DISMISS_KEY = "orca-version-warning-dismissed";

interface VersionWarningProps {
  supported: string;
  installed: string;
  onClose: () => void;
}

export function VersionWarning({ supported, installed, onClose }: VersionWarningProps) {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  const handleDismissPermanently = () => {
    if (appVersion) {
      storageSet(DISMISS_KEY, `${appVersion}:${installed}`);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title version-warning-title">Version Mismatch</h3>
        <p className="version-warning-text">
          Orca was built for agent-deck <strong>v{supported}</strong> but{" "}
          <strong>v{installed}</strong> is installed. Some features may not work correctly.
        </p>
        <div className="modal-actions">
          <button className="wt-btn" onClick={handleDismissPermanently}>
            Don&apos;t show again
          </button>
          <button className="wt-btn wt-btn-add" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
