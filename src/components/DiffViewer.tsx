import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";

interface DiffViewerProps {
  session: Session;
  onClose: () => void;
}

interface DiffLine {
  type: "addition" | "deletion" | "context";
  content: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      // Extract path from "diff --git a/path b/path"
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = { path: match?.[1] ?? line, hunks: [] };
      currentHunk = null;
      files.push(currentFile);
    } else if (line.startsWith("@@") && currentFile) {
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "addition", content: line });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "deletion", content: line });
      } else {
        currentHunk.lines.push({ type: "context", content: line });
      }
    }
  }

  return files;
}

export function DiffViewer({ session, onClose }: DiffViewerProps) {
  const { data, isLoading, error } = useQuery<string>({
    queryKey: ["branch-diff", session.id],
    queryFn: () =>
      invoke("get_branch_diff", {
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const files = data ? parseDiff(data) : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="diff-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <div className="diff-header-title">
            <span>Diff: {session.worktree_branch}</span>
            {files.length > 0 && (
              <span className="diff-file-count">
                {files.length} file{files.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button className="wt-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="diff-body">
          {isLoading && (
            <div className="loading-row">
              <span className="spinner" /> Loading diff...
            </div>
          )}
          {error && <div className="error-row">{String(error)}</div>}
          {data !== undefined && files.length === 0 && !isLoading && (
            <div className="diff-empty">No changes compared to default branch</div>
          )}
          {files.map((file) => (
            <div key={file.path} className="diff-file">
              <div className="diff-file-header">{file.path}</div>
              {file.hunks.map((hunk, hi) => (
                <div key={hi} className="diff-hunk">
                  <div className="diff-hunk-header">{hunk.header}</div>
                  {hunk.lines.map((line, li) => (
                    <div key={li} className={`diff-line diff-line-${line.type}`}>
                      {line.content}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
