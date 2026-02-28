import { useRef, useState, useEffect, useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session, WorktreeStatus, MergeResult, RebaseResult } from "../types";
import { queryKeys } from "../queryKeys";
import { trackEvent } from "../analytics";

export type MergeState =
  | "idle"
  | "confirming"
  | "rebasing"
  | "rebase_conflict"
  | "merging"
  | "success"
  | "conflict";

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
  rebaseMutation: UseMutationResult<RebaseResult, Error, void>;
  mergeMutation: UseMutationResult<MergeResult, Error, void>;
  mergeCleanupMutation: UseMutationResult<void, Error, "remove_all" | "remove_worktree" | "keep">;
  conflictSessionMutation: UseMutationResult<string, Error, void>;
  abortRebaseMutation: UseMutationResult<void, Error, void>;
  abortMergeMutation: UseMutationResult<void, Error, void>;
  isRemoving: boolean;
  startRebase: () => void;
  startMerge: () => void;
  isPending: boolean;
  mutationError: Error | null;
}

interface UseWorktreeActionsParams {
  session: Session;
  repoPath: string;
  onSelectSession?: (session: Session) => void;
  extraInvalidateKeys?: QueryKey[];
  /** When confirmingRemove state is lifted to a parent, pass the effective value here
   *  so the worktree status query fires even though the hook's internal state isn't set. */
  confirmingRemove?: boolean;
}

export function useWorktreeActions({
  session,
  repoPath,
  onSelectSession,
  extraInvalidateKeys,
  confirmingRemove: externalConfirmingRemove,
}: UseWorktreeActionsParams) {
  const queryClient = useQueryClient();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [mergeState, setMergeState] = useState<MergeState>("idle");
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<Error | null>(null);
  const mergeAfterRebase = useRef(false);

  const isWorktree = !!session.worktree_branch;
  const isRemoving = removingSessionId === session.id;

  const { data: worktreeStatus, isFetching: statusLoading } = useQuery<WorktreeStatus>({
    queryKey: queryKeys.worktreeStatus(session.worktree_path ?? ""),
    queryFn: () =>
      invoke("check_worktree_status", {
        repoPath,
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
    enabled:
      (confirmingRemove || externalConfirmingRemove || mergeState === "confirming") && isWorktree,
    staleTime: 5_000,
  });

  const mergeWarnings = worktreeStatus?.has_dirty_files
    ? worktreeStatus.warnings.filter((w) => w.includes("uncommitted"))
    : [];
  const hasWarnings = !!worktreeStatus?.warnings.length;
  const hasMergeWarnings = mergeWarnings.length > 0;

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) });
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    for (const key of extraInvalidateKeys ?? []) {
      queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
    }
  }, [queryClient, repoPath, extraInvalidateKeys]);

  // Listen for background removal events
  useEffect(() => {
    if (!removingSessionId) return;

    const unlistenRemoved = listen<{ session_id: string }>("session-removed", (event) => {
      if (event.payload.session_id === removingSessionId) {
        trackEvent("session_removed");
        setRemovingSessionId(null);
        setConfirmingRemove(false);
        invalidateAll();
      }
    });
    const unlistenFailed = listen<{ session_id: string; error: string }>(
      "session-removal-failed",
      (event) => {
        if (event.payload.session_id === removingSessionId) {
          setRemovingSessionId(null);
          setRemovalError(new Error(event.payload.error));
        }
      },
    );

    return () => {
      unlistenRemoved.then((f) => f());
      unlistenFailed.then((f) => f());
    };
  }, [removingSessionId, invalidateAll]);

  const removeMutation = useMutation({
    mutationFn: async () => {
      setRemovalError(null);
      setRemovingSessionId(session.id);
      await invoke("remove_session_background", {
        sessionId: session.id,
        repoPath: isWorktree ? repoPath : null,
        worktreePath: isWorktree ? session.worktree_path : null,
      });
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

  const rebaseMutation = useMutation({
    mutationFn: () =>
      invoke<RebaseResult>("rebase_branch", {
        worktreePath: session.worktree_path,
        mainBranch: defaultBranch ?? "main",
      }),
    onSuccess: (result) => {
      if (result.success) {
        if (mergeAfterRebase.current) {
          mergeAfterRebase.current = false;
          setMergeState("merging");
          mergeMutation.mutate();
        } else {
          setMergeState("idle");
        }
      } else {
        setMergeState("rebase_conflict");
      }
    },
    onError: () => {
      mergeAfterRebase.current = false;
      setMergeState("idle");
    },
  });

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
      if (result.success) {
        trackEvent("worktree_merged");
      }
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
        setRemovalError(null);
        setRemovingSessionId(session.id);
        setMergeState("idle");
        setMergeResult(null);
        await invoke("remove_session_background", {
          sessionId: session.id,
          repoPath,
          worktreePath: session.worktree_path,
        });
        return;
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
    onSuccess: (_, mode) => {
      if (mode !== "remove_all") {
        // remove_all is handled by the event listener
        setMergeState("idle");
        setMergeResult(null);
        invalidateAll();
      }
    },
  });

  const conflictSessionMutation = useMutation({
    mutationFn: async () => {
      const isRebaseConflict = mergeState === "rebase_conflict";
      const targetPath = isRebaseConflict ? session.worktree_path : mergeResult?.main_worktree_path;
      if (!targetPath) throw new Error("No worktree path for conflict resolution");

      const branch = defaultBranch ?? "main";
      const prompt = isRebaseConflict
        ? `A \`git rebase ${branch}\` is in progress but hit conflicts. Please resolve them:\n1. Run \`git status\` to see which files have conflicts\n2. Open each conflicted file and resolve the conflict markers (<<<<<<< ======= >>>>>>>)\n3. Stage each resolved file with \`git add <file>\`\n4. Run \`git rebase --continue\`\n5. If more conflicts appear, repeat from step 1\n\nDo NOT use \`git merge\` — this is a rebase, not a merge.`
        : `There are merge conflicts from merging '${session.worktree_branch}' into ${branch}. Please resolve all conflicts, then commit the merge.`;
      const title = isRebaseConflict
        ? `rebase-${session.worktree_branch}`
        : `merge-${session.worktree_branch}`;

      const creationId = crypto.randomUUID();
      await invoke("create_session", {
        creationId,
        projectPath: targetPath,
        group: session.group_path,
        title,
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

  const abortRebaseMutation = useMutation({
    mutationFn: (): Promise<void> =>
      invoke<void>("abort_rebase", {
        worktreePath: session.worktree_path,
      }),
    onSuccess: () => {
      setMergeState("idle");
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
    isRemoving ||
    removeMutation.isPending ||
    rebaseMutation.isPending ||
    mergeMutation.isPending ||
    mergeCleanupMutation.isPending ||
    conflictSessionMutation.isPending ||
    abortRebaseMutation.isPending ||
    abortMergeMutation.isPending;
  const mutationError =
    removalError ??
    removeMutation.error ??
    rebaseMutation.error ??
    mergeMutation.error ??
    mergeCleanupMutation.error ??
    conflictSessionMutation.error ??
    abortRebaseMutation.error ??
    abortMergeMutation.error;

  const startRebase = () => {
    mergeAfterRebase.current = false;
    setMergeState("rebasing");
    rebaseMutation.mutate();
  };

  const startMerge = () => {
    mergeAfterRebase.current = true;
    setMergeState("rebasing");
    rebaseMutation.mutate();
  };

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
    rebaseMutation,
    mergeMutation,
    mergeCleanupMutation,
    conflictSessionMutation,
    abortRebaseMutation,
    abortMergeMutation,
    isRemoving,
    startRebase,
    startMerge,
    isPending,
    mutationError,
  };
}
