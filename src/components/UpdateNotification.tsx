import { useState } from "react";
import { Modal } from "./Modal";

interface UpdateNotificationProps {
  version: string;
  notes: string;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateNotification({
  version,
  notes,
  onInstall,
  onDismiss,
}: UpdateNotificationProps) {
  const [installing, setInstalling] = useState(false);

  return (
    <Modal onClose={onDismiss}>
      <h3 className="modal-title">Update Available</h3>
      <p className="version-warning-text">
        A new version <strong>v{version}</strong> is available.
      </p>
      {notes && <p className="version-warning-text">{notes}</p>}
      <div className="modal-actions">
        <button className="wt-btn" onClick={onDismiss}>
          Later
        </button>
        <button
          className="wt-btn wt-btn-add"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            onInstall();
          }}
        >
          {installing ? "Installing..." : "Install & Restart"}
        </button>
      </div>
    </Modal>
  );
}
