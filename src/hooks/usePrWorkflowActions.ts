import { useState, useEffect, useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session, WorktreeStatus, PrInfo, RebaseResult, PushResult } from "../types";

export type PrState =
  | "idle"
  | "confirming"
  | "rebasing"
  | "rebase_conflict"
  | "pushing"
  | "editing_pr"
  | "creating_pr"
  | "pr_open"
  | "pr_merged";

export interface PrWorkflowActionsResult {
  prState: PrState;
  setPrState: (state: PrState) => void;
  isWorktree: boolean;
  isFeatureBranch: boolean;
  defaultBranch: string | undefined;
  worktreeStatus: WorktreeStatus | undefined;
  statusLoading: boolean;
  prWarnings: string[];
  hasPrWarnings: boolean;
  prInfo: PrInfo | null;
  mainUpdateWarning: string | null;

  // Mutations
  removeMutation: UseMutationResult<void, Error, void>;
  rebaseMutation: UseMutationResult<RebaseResult, Error, void>;
  pushMutation: UseMutationResult<PushResult, Error, void>;
  createPrMutation: UseMutationResult<PrInfo, Error, { title: string; body: string }>;
  rebaseAndPushMutation: UseMutationResult<void, Error, void>;
  abortRebaseMutation: UseMutationResult<void, Error, void>;
  conflictSessionMutation: UseMutationResult<string, Error, void>;
  cleanupMutation: UseMutationResult<void, Error, "remove_all" | "remove_worktree" | "keep">;

  // Computed
  isRemoving: boolean;
  isPending: boolean;
  mutationError: Error | null;

  // Actions
  startPrFlow: () => void;
  confirmPrFlow: () => void;
  submitPr: (title: string, body: string) => void;
  cancelPrFlow: () => void;
}

interface UsePrWorkflowActionsParams {
  session: Session;
  repoPath: string;
  onSelectSession?: (session: Session) => void;
  extraInvalidateKeys?: QueryKey[];
  enabled: boolean;
  defaultBranch: string | undefined;
}

export function usePrWorkflowActions({
  session,
  repoPath,
  onSelectSession,
  extraInvalidateKeys,
  enabled,
  defaultBranch,
}: UsePrWorkflowActionsParams): PrWorkflowActionsResult {
  const queryClient = useQueryClient();

  // Determine initial state from session metadata
  const initialState = (): PrState => {
    if (session.pr_state === "MERGED") return "pr_merged";
    if (session.pr_url) return "pr_open";
    return "idle";
  };

  const [prState, setPrState] = useState<PrState>(initialState);
  const [prInfo, setPrInfo] = useState<PrInfo | null>(() => {
    if (session.pr_url && session.pr_number) {
      return {
        url: session.pr_url,
        number: session.pr_number,
        state: session.pr_state ?? "OPEN",
      };
    }
    return null;
  });
  const [mainUpdateWarning, setMainUpdateWarning] = useState<string | null>(null);
  const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<Error | null>(null);

  const isWorktree = !!session.worktree_branch;
  const isRemoving = removingSessionId === session.id;
  const isFeatureBranch =
    isWorktree &&
    session.worktree_branch !== "main" &&
    session.worktree_branch !== "master" &&
    session.worktree_branch !== defaultBranch;

  const { data: worktreeStatus, isLoading: statusLoading } = useQuery<WorktreeStatus>({
    queryKey: ["worktreeStatus", session.worktree_path],
    queryFn: () =>
      invoke("check_worktree_status", {
        repoPath,
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
    enabled: enabled && prState === "confirming" && isWorktree,
    staleTime: 5_000,
  });

  const prWarnings = worktreeStatus?.has_dirty_files
    ? worktreeStatus.warnings.filter((w) => w.includes("uncommitted"))
    : [];
  const hasPrWarnings = prWarnings.length > 0;

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["worktrees", repoPath] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    for (const key of extraInvalidateKeys ?? []) {
      queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
    }
  }, [queryClient, repoPath, extraInvalidateKeys]);

  // Listen for background removal events
  useEffect(() => {
    if (!removingSessionId) return;

    const unlistenRemoved = listen<{ session_id: string }>("session-removed", (event) => {
      if (event.payload.session_id === removingSessionId) {
        setRemovingSessionId(null);
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

  // PR status polling
  useQuery<PrInfo>({
    queryKey: ["prStatus", repoPath, session.worktree_branch],
    queryFn: () =>
      invoke("check_pr_status", {
        repoPath,
        branch: session.worktree_branch,
      }),
    refetchInterval: 30_000,
    enabled: enabled && prState === "pr_open",
    select: (data) => {
      if (data.state === "MERGED" && prState === "pr_open") {
        setPrState("pr_merged");
        setPrInfo(data);
        // Persist merged state
        invoke("store_session_pr_info", {
          sessionId: session.id,
          prUrl: data.url,
          prNumber: data.number,
          prState: "MERGED",
        }).catch((err) => console.warn("Failed to store PR merged state:", err));
        // Best-effort update main
        invoke<PushResult>("update_main_branch", {
          repoPath,
          mainBranch: defaultBranch ?? "main",
        })
          .then((result) => {
            if (!result.success) {
              setMainUpdateWarning(result.message);
            }
          })
          .catch((err) => {
            setMainUpdateWarning(String(err));
          });
      }
      return data;
    },
  });

  // Remove session mutation (background)
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

  // Rebase mutation
  const rebaseMutation = useMutation({
    mutationFn: () =>
      invoke<RebaseResult>("rebase_branch", {
        worktreePath: session.worktree_path,
        mainBranch: defaultBranch ?? "main",
      }),
    onSuccess: (result) => {
      if (result.success) {
        setPrState("pushing");
        pushMutation.mutate();
      } else {
        setPrState("rebase_conflict");
      }
    },
    onError: () => {
      setPrState("idle");
    },
  });

  // Push mutation
  const pushMutation = useMutation({
    mutationFn: () =>
      invoke<PushResult>("push_branch", {
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
    onSuccess: (result) => {
      if (result.success) {
        setPrState("editing_pr");
      } else {
        setPrState("idle");
      }
    },
    onError: () => {
      setPrState("idle");
    },
  });

  // Create PR mutation
  const createPrMutation = useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) =>
      invoke<PrInfo>("create_pr", {
        repoPath,
        branch: session.worktree_branch,
        baseBranch: defaultBranch ?? "main",
        title,
        body,
      }),
    onSuccess: (info) => {
      setPrInfo(info);
      setPrState("pr_open");
      // Persist PR info
      invoke("store_session_pr_info", {
        sessionId: session.id,
        prUrl: info.url,
        prNumber: info.number,
        prState: info.state,
      }).catch((err) => console.warn("Failed to store PR info:", err));
    },
    onError: () => {
      setPrState("editing_pr");
    },
  });

  // Rebase & Push (for updating open PRs)
  const rebaseAndPushMutation = useMutation({
    mutationFn: async () => {
      const rebaseResult = await invoke<RebaseResult>("rebase_branch", {
        worktreePath: session.worktree_path,
        mainBranch: defaultBranch ?? "main",
      });
      if (!rebaseResult.success) {
        setPrState("rebase_conflict");
        throw new Error(rebaseResult.conflict_message ?? "Rebase conflict");
      }
      const pushResult = await invoke<PushResult>("force_push_branch", {
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      });
      if (!pushResult.success) {
        throw new Error(pushResult.message || "Push failed");
      }
    },
    onSuccess: () => {
      setPrState("pr_open");
      invalidateAll();
    },
    onError: () => {
      // If it was a rebase conflict, state is already set
      if (prState !== "rebase_conflict") {
        setPrState("pr_open");
      }
    },
  });

  // Abort rebase
  const abortRebaseMutation = useMutation({
    mutationFn: (): Promise<void> =>
      invoke<void>("abort_rebase", {
        worktreePath: session.worktree_path,
      }),
    onSuccess: () => {
      // Return to pr_open if we were rebasing for an existing PR, else idle
      setPrState(prInfo ? "pr_open" : "idle");
    },
  });

  // Create conflict resolution session
  const conflictSessionMutation = useMutation({
    mutationFn: async () => {
      const prompt = `There are rebase conflicts from rebasing onto ${defaultBranch ?? "main"}. Please resolve all conflicts and continue the rebase with \`git rebase --continue\`.`;
      const creationId = crypto.randomUUID();
      await invoke("create_session", {
        creationId,
        projectPath: session.worktree_path,
        group: session.group_path,
        title: `rebase-${session.worktree_branch}`,
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
      setPrState(prInfo ? "pr_open" : "idle");
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (onSelectSession) {
        const sessions = await invoke<Session[]>("get_sessions", {
          groupPath: session.group_path,
        });
        const created = sessions.find((s) => s.id === sessionId);
        if (created) onSelectSession(created);
      }
    },
  });

  // Cleanup after merge
  const cleanupMutation = useMutation({
    mutationFn: async (mode: "remove_all" | "remove_worktree" | "keep") => {
      if (mode === "remove_all") {
        setRemovalError(null);
        setRemovingSessionId(session.id);
        setPrState("idle");
        setPrInfo(null);
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
        setPrState("idle");
        setPrInfo(null);
        invalidateAll();
      }
    },
  });

  const isPending =
    isRemoving ||
    removeMutation.isPending ||
    rebaseMutation.isPending ||
    pushMutation.isPending ||
    createPrMutation.isPending ||
    rebaseAndPushMutation.isPending ||
    abortRebaseMutation.isPending ||
    conflictSessionMutation.isPending ||
    cleanupMutation.isPending;

  const mutationError =
    removalError ??
    removeMutation.error ??
    rebaseMutation.error ??
    pushMutation.error ??
    createPrMutation.error ??
    rebaseAndPushMutation.error ??
    abortRebaseMutation.error ??
    conflictSessionMutation.error ??
    cleanupMutation.error;

  const startPrFlow = () => setPrState("confirming");
  const confirmPrFlow = () => {
    setPrState("rebasing");
    rebaseMutation.mutate();
  };
  const submitPr = (title: string, body: string) => {
    setPrState("creating_pr");
    createPrMutation.mutate({ title, body });
  };
  const cancelPrFlow = () => setPrState("idle");

  return {
    prState,
    setPrState,
    isWorktree,
    isFeatureBranch,
    defaultBranch,
    worktreeStatus,
    statusLoading,
    prWarnings,
    hasPrWarnings,
    prInfo,
    mainUpdateWarning,
    removeMutation,
    rebaseMutation,
    pushMutation,
    createPrMutation,
    rebaseAndPushMutation,
    abortRebaseMutation,
    conflictSessionMutation,
    cleanupMutation,
    isRemoving,
    isPending,
    mutationError,
    startPrFlow,
    confirmPrFlow,
    submitPr,
    cancelPrFlow,
  };
}
