import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";

interface RenameModalProps {
  session: Session;
  onClose: () => void;
}

export function RenameModal({ session, onClose }: RenameModalProps) {
  const [title, setTitle] = useState(session.title);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      invoke("rename_session", {
        sessionId: session.id,
        newTitle: title.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      onClose();
    },
  });

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== session.title) {
      mutation.mutate();
    } else {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Rename Session</h3>
        <input
          className="modal-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          autoFocus
        />
        {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-add"
            onClick={handleSubmit}
            disabled={!title.trim() || mutation.isPending}
          >
            Rename
          </button>
          <button className="wt-btn wt-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
