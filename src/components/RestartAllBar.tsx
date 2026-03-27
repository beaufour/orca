import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";
import { queryKeys } from "../queryKeys";

interface RestartAllBarProps {
  sessions: Session[] | undefined;
  liveTmuxSessions?: Set<string>;
  /** When set, only restart sessions in this group. Omit for all groups. */
  groupPath?: string;
}

export function RestartAllBar({ sessions, liveTmuxSessions, groupPath }: RestartAllBarProps) {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);

  const deadCount = (sessions ?? []).filter(
    (s) => s.tmux_session && liveTmuxSessions && !liveTmuxSessions.has(s.tmux_session),
  ).length;

  const handleRestartAll = useCallback(async () => {
    setRestarting(true);
    try {
      await invoke("restart_all_sessions", {
        groupPath: groupPath ?? null,
        resume: true,
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
        setRestarting(false);
      }, 2000);
    } catch (err) {
      console.error("Restart all failed:", err);
      setRestarting(false);
    }
  }, [groupPath, queryClient]);

  if (deadCount === 0) return null;

  return (
    <div className="restart-all-bar">
      <button
        className="wt-btn wt-btn-action"
        onClick={handleRestartAll}
        disabled={restarting}
        title={`Restart ${deadCount} dead session${deadCount === 1 ? "" : "s"} and resume Claude conversations`}
      >
        {restarting ? "Restarting..." : `Restart All (${deadCount})`}
      </button>
    </div>
  );
}
