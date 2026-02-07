import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session, Group } from "../types";

interface MoveSessionModalProps {
  session: Session;
  groups: Group[];
  onClose: () => void;
}

export function MoveSessionModal({ session, groups, onClose }: MoveSessionModalProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newGroupPath: string) =>
      invoke("move_session", {
        sessionId: session.id,
        newGroupPath,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Move "{session.title}" to group</h3>
        {mutation.error && (
          <div className="wt-error">{String(mutation.error)}</div>
        )}
        <div className="group-select-list">
          {groups.map((group) => {
            const isCurrent = group.path === session.group_path;
            return (
              <button
                key={group.path}
                className={`group-select-item${isCurrent ? " group-select-current" : ""}`}
                onClick={() => !isCurrent && mutation.mutate(group.path)}
                disabled={isCurrent || mutation.isPending}
              >
                {group.name}
                {isCurrent && <span className="group-select-label">current</span>}
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="wt-btn wt-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
