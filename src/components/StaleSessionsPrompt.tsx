import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { storageSet } from "../utils";
import { Modal } from "./Modal";
import { queryKeys } from "../queryKeys";

export const STALE_SESSIONS_DISMISS_KEY = "orca-stale-sessions-dismissed";

export interface StaleClaudeSession {
  id: string;
  title: string;
  group_name: string;
  running_version: string;
}

interface StaleSessionsPromptProps {
  currentVersion: string;
  stale: StaleClaudeSession[];
  onClose: () => void;
}

export function StaleSessionsPrompt({ currentVersion, stale, onClose }: StaleSessionsPromptProps) {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const handleDismiss = () => {
    const key = stale
      .map((s) => `${s.id}:${s.running_version}`)
      .sort()
      .join(",");
    storageSet(STALE_SESSIONS_DISMISS_KEY, `${currentVersion}:${key}`);
    onClose();
  };

  const handleRestartAll = async () => {
    setRestarting(true);
    setErrors([]);
    setDone(0);
    for (const s of stale) {
      try {
        await invoke("restart_session", { sessionId: s.id, resume: true });
        setDone((n) => n + 1);
      } catch (err) {
        setErrors((prev) => [...prev, `${s.title}: ${String(err)}`]);
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.tmuxSessions });
    setRestarting(false);
    onClose();
  };

  return (
    <Modal onClose={restarting ? () => {} : onClose}>
      <h3 className="modal-title stale-sessions-title">Outdated Claude sessions</h3>
      <p className="stale-sessions-text">
        {stale.length === 1 ? (
          <>
            1 running session is on an older Claude. Restart to pick up{" "}
            <strong>v{currentVersion}</strong>. The conversation will be resumed.
          </>
        ) : (
          <>
            {stale.length} running sessions are on an older Claude. Restart them to pick up{" "}
            <strong>v{currentVersion}</strong>. Each conversation will be resumed.
          </>
        )}
      </p>
      <ul className="stale-sessions-list">
        {stale.map((s) => (
          <li key={s.id}>
            <span className="stale-sessions-item-title">
              {s.group_name && <span className="stale-sessions-item-group">{s.group_name} / </span>}
              {s.title}
            </span>
            <span className="stale-sessions-item-version">v{s.running_version}</span>
          </li>
        ))}
      </ul>
      {restarting && (
        <p className="stale-sessions-progress">
          Restarted {done} / {stale.length}...
        </p>
      )}
      {errors.length > 0 && (
        <ul className="stale-sessions-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button className="wt-btn" onClick={handleDismiss} disabled={restarting}>
          Don&apos;t show again
        </button>
        <button className="wt-btn" onClick={onClose} disabled={restarting}>
          Later
        </button>
        <button
          className="wt-btn wt-btn-add"
          onClick={handleRestartAll}
          disabled={restarting || stale.length === 0}
        >
          {restarting ? "Restarting..." : `Restart ${stale.length}`}
        </button>
      </div>
    </Modal>
  );
}
