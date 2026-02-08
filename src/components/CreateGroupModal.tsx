import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface CreateGroupModalProps {
  onClose: () => void;
}

export function CreateGroupModal({ onClose }: CreateGroupModalProps) {
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [defaultPath, setDefaultPath] = useState("");
  const queryClient = useQueryClient();

  const setPathAndDefaultName = (path: string) => {
    setDefaultPath(path);
    if (!nameManuallyEdited) {
      const basename = path.replace(/\/+$/, "").split("/").pop() ?? "";
      setName(basename);
    }
  };

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
        <label className="modal-label">Repo path</label>
        <div className="modal-input-row">
          <input
            className="modal-input modal-input-flex"
            type="text"
            placeholder="/Users/you/repos/my-project"
            value={defaultPath}
            onChange={(e) => setPathAndDefaultName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onClose();
            }}
            autoFocus
          />
          <button
            className="wt-btn"
            type="button"
            onClick={async () => {
              const selected = await open({
                directory: true,
                multiple: false,
                title: "Select repo directory",
              });
              if (selected) {
                setPathAndDefaultName(selected);
              }
            }}
          >
            Browse
          </button>
        </div>
        <label className="modal-label">Group name</label>
        <input
          className="modal-input"
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameManuallyEdited(true);
          }}
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
