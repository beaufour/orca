import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";
import { queryKeys } from "../queryKeys";

interface MainSessionGhostProps {
  repoPath: string;
  groupPath: string;
  onSessionReady?: (session: Session) => void;
}

export function MainSessionGhost({ repoPath, groupPath, onSessionReady }: MainSessionGhostProps) {
  const queryClient = useQueryClient();

  const { data: defaultBranch } = useQuery<string>({
    queryKey: queryKeys.defaultBranch(repoPath),
    queryFn: () => invoke("get_default_branch", { repoPath }),
    staleTime: 5 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      invoke<string>("create_session", {
        projectPath: repoPath,
        group: groupPath,
        title: defaultBranch ?? "main",
        tool: "claude",
        worktreeBranch: null,
        newBranch: false,
        start: true,
      }),
    onSuccess: async (sessionId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
      // Fetch fresh session list and auto-open the new session
      if (onSessionReady) {
        const sessions = await invoke<Session[]>("get_sessions", {
          groupPath: groupPath,
        });
        const created = sessions.find((s) => s.id === sessionId);
        if (created) onSessionReady(created);
      }
    },
  });

  const branchLabel = defaultBranch ?? "main";

  return (
    <div
      className={`session-card session-card-ghost ${createMutation.isPending ? "session-card-ghost-creating" : ""}`}
      onClick={() => {
        if (!createMutation.isPending) createMutation.mutate();
      }}
    >
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{branchLabel}</span>
        </div>
      </div>
      <div className="session-card-body">
        <div className="session-summary session-ghost-hint">
          {createMutation.isPending ? (
            <>
              <span className="spinner" /> Creating session...
            </>
          ) : (
            "Click to create main session"
          )}
        </div>
      </div>
      {createMutation.error && (
        <div className="session-wt-error">{String(createMutation.error)}</div>
      )}
    </div>
  );
}
