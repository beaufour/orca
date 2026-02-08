import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

interface MainSessionGhostProps {
  repoPath: string;
  groupPath: string;
}

export function MainSessionGhost({ repoPath, groupPath }: MainSessionGhostProps) {
  const queryClient = useQueryClient();

  const { data: defaultBranch } = useQuery<string>({
    queryKey: ["defaultBranch", repoPath],
    queryFn: () => invoke("get_default_branch", { repoPath }),
    staleTime: 5 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      invoke("create_session", {
        projectPath: repoPath,
        group: groupPath,
        title: defaultBranch ?? "main",
        tool: "claude",
        worktreeBranch: null,
        newBranch: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
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
            <><span className="spinner" /> Creating session...</>
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
