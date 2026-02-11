import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session, Group } from "../types";
import { queryKeys } from "../queryKeys";
import { Modal } from "./Modal";

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
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      onClose();
    },
  });

  return (
    <Modal onClose={onClose}>
      <h3 className="modal-title">Move "{session.title}" to group</h3>
      {mutation.error && <div className="wt-error">{String(mutation.error)}</div>}
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
    </Modal>
  );
}
