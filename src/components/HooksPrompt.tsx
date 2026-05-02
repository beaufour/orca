import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { storageSet, HOOKS_PROMPT_DISMISS_KEY } from "../utils";
import type { HookStatus } from "../types";
import { Modal } from "./Modal";

interface HooksPromptProps {
  status: HookStatus;
  onClose: () => void;
}

export function HooksPrompt({ status, onClose }: HooksPromptProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke<HookStatus>("install_claude_hooks");
      onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setInstalling(false);
    }
  };

  const handleDismissPermanently = () => {
    storageSet(HOOKS_PROMPT_DISMISS_KEY, "true");
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="modal-title">Detect Claude attention more reliably</h3>
      <p className="version-warning-text">
        Orca can install two small hooks in your Claude Code settings so it knows the moment a
        session is waiting on you (asking permission, finishing a turn, etc.) instead of guessing
        from log files.
      </p>
      <p className="version-warning-text" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
        Adds <code>Notification</code>, <code>Stop</code>, and <code>UserPromptSubmit</code> entries
        to <code>{status.settings_path}</code>, pointing at a tiny shim script at{" "}
        <code>{status.shim_path}</code>. Existing hooks are preserved. You can remove them anytime
        from App Settings.
      </p>
      {error && (
        <p className="version-warning-text" style={{ color: "var(--accent-error)" }}>
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="wt-btn" onClick={handleDismissPermanently} disabled={installing}>
          Don&apos;t ask again
        </button>
        <button className="wt-btn" onClick={onClose} disabled={installing}>
          Not now
        </button>
        <button className="wt-btn wt-btn-add" onClick={handleInstall} disabled={installing}>
          {installing ? "Installing…" : "Install hooks"}
        </button>
      </div>
    </Modal>
  );
}
