import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session, WorktreeStatus, MergeResult } from "../types";
import { queryKeys } from "../queryKeys";

export type MergeState = "idle" | "confirming" | "merging" | "success" | "conflict";

/** The return type of useWorktreeActions, with setters widened for prop compatibility */
export interface WorktreeActionsResult {
  isWorktree: boolean;
  isFeatureBranch: boolean;
  defaultBranch: string | undefined;
  confirmingRemove: boolean;
  setConfirmingRemove: (value: boolean) => void;
  mergeState: MergeState;
  setMergeState: (value: MergeState) => void;
  mergeResult: MergeResult | null;
  worktreeStatus: WorktreeStatus | undefined;
  statusLoading: boolean;
  mergeWarnings: string[];
  hasWarnings: boolean;
  hasMergeWarnings: boolean;
  removeMutation: UseMutationResult<void, Error, void>;
  mergeMutation: UseMutationResult<MergeResult, Error, void>;
  mergeCleanupMutation: UseMutationResult<void, Error, "remove_all" | "remove_worktree" | "keep">;
  conflictSessionMutation: UseMutationResult<string, Error, void>;
  abortMergeMutation: UseMutationResult<void, Error, void>;
  isPending: boolean;
  mutationError: Error | null;
}

interface UseWorktreeActionsParams {
  session: Session;
  repoPath: string;
  onSelectSession?: (session: Session) => void;
  extraInvalidateKeys?: QueryKey[];
}

export function useWorktreeActions({
  session,
  repoPath,
  onSelectSession,
  extraInvalidateKeys,
}: UseWorktreeActionsParams) {
  const queryClient = useQueryClient();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [mergeState, setMergeState] = useState<MergeState>("idle");
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

  const isWorktree = !!session.worktree_branch;

  const { data: worktreeStatus, isLoading: statusLoading } = useQuery<WorktreeStatus>({
    queryKey: queryKeys.worktreeStatus(session.worktree_path ?? ""),
    queryFn: () =>
      invoke("check_worktree_status", {
        repoPath,
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
    enabled: (confirmingRemove || mergeState === "confirming") && isWorktree,
    staleTime: 5_000,
  });

  const mergeWarnings = worktreeStatus?.has_dirty_files
    ? worktreeStatus.warnings.filter((w) => w.includes("uncommitted"))
    : [];
  const hasWarnings = !!worktreeStatus?.warnings.length;
  const hasMergeWarnings = mergeWarnings.length > 0;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) });
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    for (const key of extraInvalidateKeys ?? []) {
      queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
    }
  };

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (isWorktree) {
        try {
          await invoke("remove_worktree", {
            repoPath,
            worktreePath: session.worktree_path,
          });
        } catch {
          // Worktree may already be gone — continue with session removal
        }
      }
      await invoke("remove_session", { sessionId: session.id });
    },
    onSuccess: () => {
      setConfirmingRemove(false);
      invalidateAll();
    },
  });

  const { data: defaultBranch } = useQuery<string>({
    queryKey: queryKeys.defaultBranch(repoPath),
    queryFn: () => invoke("get_default_branch", { repoPath }),
    staleTime: 5 * 60 * 1000,
    enabled: isWorktree,
  });

  const isFeatureBranch =
    isWorktree &&
    session.worktree_branch !== "main" &&
    session.worktree_branch !== "master" &&
    session.worktree_branch !== defaultBranch;

  const mergeMutation = useMutation({
    mutationFn: () =>
      invoke<MergeResult>("try_merge_branch", {
        repoPath,
        branch: session.worktree_branch,
        mainBranch: defaultBranch ?? "main",
      }),
    onSuccess: (result) => {
      setMergeResult(result);
      setMergeState(result.success ? "success" : "conflict");
      // Clear cached worktree status so the remove dialog doesn't show stale "not merged" data
      queryClient.removeQueries({
        queryKey: queryKeys.worktreeStatus(session.worktree_path ?? ""),
      });
    },
    onError: () => {
      setMergeState("idle");
    },
  });

  const mergeCleanupMutation = useMutation({
    mutationFn: async (mode: "remove_all" | "remove_worktree" | "keep") => {
      if (mode === "remove_all") {
        try {
          await invoke("remove_worktree", {
            repoPath,
            worktreePath: session.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
        await invoke("remove_session", { sessionId: session.id });
      } else if (mode === "remove_worktree") {
        try {
          await invoke("remove_worktree", {
            repoPath,
            worktreePath: session.worktree_path,
          });
        } catch {
          // Worktree may already be gone
        }
        await invoke("clear_session_worktree", { sessionId: session.id });
      }
      // mode === "keep" — do nothing
    },
    onSuccess: () => {
      setMergeState("idle");
      setMergeResult(null);
      invalidateAll();
    },
  });

  const conflictSessionMutation = useMutation({
    mutationFn: async () => {
      const mainPath = mergeResult?.main_worktree_path;
      if (!mainPath) throw new Error("No main worktree path");
      const prompt = `There are merge conflicts from merging '${session.worktree_branch}' into ${defaultBranch ?? "main"}. Please resolve all conflicts, then commit the merge.`;
      const creationId = crypto.randomUUID();
      await invoke("create_session", {
        creationId,
        projectPath: mainPath,
        group: session.group_path,
        title: `merge-${session.worktree_branch}`,
        tool: "claude",
        worktreeBranch: null,
        newBranch: false,
        start: true,
        prompt,
      });
      // Wait for session-created event to get the session ID
      const sessionId = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Session creation timed out")), 60_000);
        listen<{ creation_id: string; session_id: string }>("session-created", (event) => {
          if (event.payload.creation_id === creationId) {
            clearTimeout(timeout);
            resolve(event.payload.session_id);
          }
        });
        listen<{ creation_id: string; error: string }>("session-creation-failed", (event) => {
          if (event.payload.creation_id === creationId) {
            clearTimeout(timeout);
            reject(new Error(event.payload.error));
          }
        });
      });
      return sessionId;
    },
    onSuccess: async (sessionId) => {
      setMergeState("idle");
      setMergeResult(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
      if (onSelectSession) {
        const sessions = await invoke<Session[]>("get_sessions", {
          groupPath: session.group_path,
        });
        const created = sessions.find((s) => s.id === sessionId);
        if (created) onSelectSession(created);
      }
    },
  });

  const abortMergeMutation = useMutation({
    mutationFn: (): Promise<void> => {
      const mainPath = mergeResult?.main_worktree_path;
      if (!mainPath) throw new Error("No main worktree path");
      return invoke<void>("abort_merge", { worktreePath: mainPath });
    },
    onSuccess: () => {
      setMergeState("idle");
      setMergeResult(null);
    },
  });

  const isPending =
    removeMutation.isPending ||
    mergeMutation.isPending ||
    mergeCleanupMutation.isPending ||
    conflictSessionMutation.isPending ||
    abortMergeMutation.isPending;
  const mutationError =
    removeMutation.error ??
    mergeMutation.error ??
    mergeCleanupMutation.error ??
    conflictSessionMutation.error ??
    abortMergeMutation.error;

  return {
    isWorktree,
    isFeatureBranch,
    defaultBranch,
    confirmingRemove,
    setConfirmingRemove,
    mergeState,
    setMergeState,
    mergeResult,
    worktreeStatus,
    statusLoading,
    mergeWarnings,
    hasWarnings,
    hasMergeWarnings,
    removeMutation,
    mergeMutation,
    mergeCleanupMutation,
    conflictSessionMutation,
    abortMergeMutation,
    isPending,
    mutationError,
  };
}
