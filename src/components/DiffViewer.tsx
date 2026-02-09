import { useCallback, useEffect, useRef } from "react";
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
  additions: number;
  deletions: number;
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      // Extract path from "diff --git a/path b/path"
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = {
        path: match?.[1] ?? line,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      files.push(currentFile);
    } else if (line.startsWith("@@") && currentFile) {
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "addition", content: line });
        if (currentFile) currentFile.additions++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "deletion", content: line });
        if (currentFile) currentFile.deletions++;
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const scrollToFile = useCallback((path: string) => {
    const el = fileRefs.current.get(path);
    const container = bodyRef.current;
    if (el && container) {
      container.scrollTo({
        top: el.offsetTop - container.offsetTop,
        behavior: "smooth",
      });
    }
  }, []);

  const setFileRef = useCallback(
    (path: string) => (el: HTMLDivElement | null) => {
      if (el) {
        fileRefs.current.set(path, el);
      } else {
        fileRefs.current.delete(path);
      }
    },
    [],
  );

  /** Just the filename from a full path */
  const fileName = (path: string) => {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.slice(i + 1);
  };

  /** The directory portion, or empty */
  const fileDir = (path: string) => {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i + 1);
  };

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
        <div className="diff-layout">
          {files.length > 0 && (
            <div className="diff-file-list">
              {files.map((file) => (
                <button
                  key={file.path}
                  className="diff-file-list-item"
                  onClick={() => scrollToFile(file.path)}
                  title={file.path}
                >
                  <span className="diff-file-list-name">
                    <span className="diff-file-list-dir">{fileDir(file.path)}</span>
                    {fileName(file.path)}
                  </span>
                  <span className="diff-file-list-stats">
                    <span className="diff-stat-add">+{file.additions}</span>
                    <span className="diff-stat-del">-{file.deletions}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="diff-body" ref={bodyRef}>
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
              <div key={file.path} className="diff-file" ref={setFileRef(file.path)}>
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
    </div>
  );
}
