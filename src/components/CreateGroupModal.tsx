import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

interface CreateGroupModalProps {
  onClose: () => void;
}

export function CreateGroupModal({ onClose }: CreateGroupModalProps) {
  const [name, setName] = useState("");
  const [defaultPath, setDefaultPath] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      invoke("create_group", {
        name: name.trim(),
        defaultPath: defaultPath.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (name.trim() && defaultPath.trim()) {
      mutation.mutate();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Create Group</h3>
        <label className="modal-label">Group name</label>
        <input
          className="modal-input"
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          autoFocus
        />
        <label className="modal-label">Default repo path</label>
        <input
          className="modal-input"
          type="text"
          placeholder="/Users/you/repos/my-project"
          value={defaultPath}
          onChange={(e) => setDefaultPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
        />
        {mutation.error && (
          <div className="wt-error">{String(mutation.error)}</div>
        )}
        <div className="modal-actions">
          <button
            className="wt-btn wt-btn-add"
            onClick={handleSubmit}
            disabled={!name.trim() || !defaultPath.trim() || mutation.isPending}
          >
            Create
          </button>
          <button className="wt-btn wt-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
