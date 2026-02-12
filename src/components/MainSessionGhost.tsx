import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "../queryKeys";

interface CreateSessionParams {
  projectPath: string;
  group: string;
  title: string;
  tool?: string;
  worktreeBranch?: string | null;
  newBranch?: boolean;
  start?: boolean;
  prompt?: string | null;
}

interface MainSessionGhostProps {
  repoPath: string;
  groupPath: string;
  createSession?: (params: CreateSessionParams) => void;
}

export function MainSessionGhost({ repoPath, groupPath, createSession }: MainSessionGhostProps) {
  const [clicked, setClicked] = useState(false);

  const { data: defaultBranch } = useQuery<string>({
    queryKey: queryKeys.defaultBranch(repoPath),
    queryFn: () => invoke("get_default_branch", { repoPath }),
    staleTime: 5 * 60 * 1000,
  });

  const branchLabel = defaultBranch ?? "main";

  const handleClick = () => {
    if (clicked || !createSession) return;
    setClicked(true);
    createSession({
      projectPath: repoPath,
      group: groupPath,
      title: branchLabel,
      tool: "claude",
      worktreeBranch: null,
      newBranch: false,
      start: true,
    });
  };

  return (
    <div
      className={`session-card session-card-ghost ${clicked ? "session-card-ghost-creating" : ""}`}
      onClick={handleClick}
    >
      <div className="session-card-header">
        <div className="session-title-row">
          <span className="session-title">{branchLabel}</span>
        </div>
      </div>
      <div className="session-card-body">
        <div className="session-summary session-ghost-hint">
          {clicked ? (
            <>
              <span className="spinner" /> Creating session...
            </>
          ) : (
            "Click to create main session"
          )}
        </div>
      </div>
    </div>
  );
}
