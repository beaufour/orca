import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface PendingCreation {
  creationId: string;
  title: string;
  branch?: string;
  groupPath: string;
  startedAt: number;
  error?: string;
}

interface CreateSessionParams {
  projectPath: string;
  group: string;
  title: string;
  tool?: string;
  worktreeBranch?: string | null;
  newBranch?: boolean;
  start?: boolean;
  prompt?: string | null;
  components?: string[];
}

interface UseSessionCreationOptions {
  onCreated?: (creationId: string, sessionId: string) => void;
}

export function useSessionCreation({ onCreated }: UseSessionCreationOptions = {}) {
  const [pendingCreations, setPendingCreations] = useState<Map<string, PendingCreation>>(new Map());
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    listen<{ creation_id: string; session_id: string }>("session-created", (event) => {
      const { creation_id, session_id } = event.payload;
      setPendingCreations((prev) => {
        const next = new Map(prev);
        next.delete(creation_id);
        return next;
      });
      onCreatedRef.current?.(creation_id, session_id);
    }).then((fn) => unlisteners.push(fn));

    listen<{ creation_id: string; error: string }>("session-creation-failed", (event) => {
      const { creation_id, error } = event.payload;
      setPendingCreations((prev) => {
        const existing = prev.get(creation_id);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(creation_id, { ...existing, error });
        return next;
      });
    }).then((fn) => unlisteners.push(fn));

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  const createSession = useCallback((params: CreateSessionParams) => {
    const creationId = crypto.randomUUID();
    const pending: PendingCreation = {
      creationId,
      title: params.title,
      branch: params.worktreeBranch ?? undefined,
      groupPath: params.group,
      startedAt: Date.now(),
    };
    setPendingCreations((prev) => {
      const next = new Map(prev);
      next.set(creationId, pending);
      return next;
    });

    // Fire-and-forget: the backend returns immediately, result comes via events
    invoke("create_session", {
      creationId,
      projectPath: params.projectPath,
      group: params.group,
      title: params.title,
      tool: params.tool ?? null,
      worktreeBranch: params.worktreeBranch ?? null,
      newBranch: params.newBranch ?? false,
      start: params.start ?? false,
      prompt: params.prompt ?? null,
      components: params.components ?? null,
    }).catch((err) => {
      // Handle invoke-level errors (e.g. command not found)
      setPendingCreations((prev) => {
        const existing = prev.get(creationId);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(creationId, { ...existing, error: String(err) });
        return next;
      });
    });
  }, []);

  const dismissPending = useCallback((creationId: string) => {
    setPendingCreations((prev) => {
      const next = new Map(prev);
      next.delete(creationId);
      return next;
    });
  }, []);

  return { pendingCreations, createSession, dismissPending };
}
