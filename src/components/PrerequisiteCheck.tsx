import { useState } from "react";
import { storageSet } from "../utils";
import { Modal } from "./Modal";

const DISMISS_KEY = "orca-prerequisites-dismissed";

interface PrerequisiteStatus {
  name: string;
  found: boolean;
  required: boolean;
}

interface PrerequisiteCheckProps {
  missing: PrerequisiteStatus[];
  onClose: () => void;
}

export function PrerequisiteCheck({ missing, onClose }: PrerequisiteCheckProps) {
  const [dontShow, setDontShow] = useState(false);

  const handleClose = () => {
    if (dontShow) {
      const key = missing
        .map((m) => m.name)
        .sort()
        .join(",");
      storageSet(DISMISS_KEY, key);
    }
    onClose();
  };

  const requiredMissing = missing.filter((m) => m.required);
  const optionalMissing = missing.filter((m) => !m.required);

  return (
    <Modal onClose={handleClose}>
      <h3 className="modal-title prereq-title">Missing Dependencies</h3>

      {requiredMissing.length > 0 && (
        <div className="prereq-section">
          <p className="prereq-label prereq-label-required">Required</p>
          <ul className="prereq-list">
            {requiredMissing.map((m) => (
              <li key={m.name} className="prereq-item prereq-item-required">
                <code>{m.name}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {optionalMissing.length > 0 && (
        <div className="prereq-section">
          <p className="prereq-label">Optional (needed for git/GitHub features)</p>
          <ul className="prereq-list">
            {optionalMissing.map((m) => (
              <li key={m.name} className="prereq-item prereq-item-optional">
                <code>{m.name}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="modal-actions prereq-actions">
        <label className="prereq-checkbox-label">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          Don&apos;t show again
        </label>
        <button className="wt-btn wt-btn-add" onClick={handleClose}>
          OK
        </button>
      </div>
    </Modal>
  );
}

export { DISMISS_KEY };
export type { PrerequisiteStatus };
