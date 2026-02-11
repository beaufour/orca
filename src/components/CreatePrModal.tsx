import { useState } from "react";

interface CreatePrModalProps {
  branch: string;
  sessionTitle: string;
  defaultBody: string;
  baseBranch: string;
  onSubmit: (title: string, body: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function CreatePrModal({
  branch,
  sessionTitle,
  defaultBody,
  baseBranch,
  onSubmit,
  onCancel,
  isPending,
}: CreatePrModalProps) {
  const [title, setTitle] = useState(sessionTitle);
  const [body, setBody] = useState(defaultBody);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-content modal-content-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Create Pull Request</h3>
        <label className="modal-label">Title</label>
        <input
          className="modal-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) {
              onSubmit(title, body);
            }
            if (e.key === "Escape") onCancel();
          }}
          autoFocus
        />
        <label className="modal-label">Body</label>
        <textarea
          className="modal-input modal-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          rows={5}
        />
        <div className="pr-modal-branch-info">
          Base: {baseBranch} &larr; Head: {branch}
        </div>
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-pr"
            onClick={() => onSubmit(title, body)}
            disabled={!title.trim() || isPending}
          >
            Create PR
          </button>
          <button className="wt-btn wt-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
