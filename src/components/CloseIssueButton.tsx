import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CloseIssueButtonProps {
  repoPath: string;
  issueNumber: number;
}

export function CloseIssueButton({ repoPath, issueNumber }: CloseIssueButtonProps) {
  const [closeState, setCloseState] = useState<"idle" | "closing" | "closed">("idle");

  if (closeState === "closed") {
    return <span className="merge-success-label">Closed #{issueNumber}</span>;
  }

  return (
    <button
      className="wt-btn wt-btn-action"
      disabled={closeState === "closing"}
      onClick={(e) => {
        e.stopPropagation();
        setCloseState("closing");
        invoke("close_issue", { repoPath, issueNumber })
          .then(() => setCloseState("closed"))
          .catch((err) => {
            console.error("Failed to close issue:", err);
            setCloseState("idle");
          });
      }}
    >
      {closeState === "closing" ? "Closing..." : `Close #${issueNumber}`}
    </button>
  );
}
