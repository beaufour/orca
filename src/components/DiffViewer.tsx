import { useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";
import { parseDiff, fileName, fileDir } from "../utils";
import { queryKeys } from "../queryKeys";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { Modal } from "./Modal";

interface DiffViewerProps {
  session: Session;
  onClose: () => void;
}

export function DiffViewer({ session, onClose }: DiffViewerProps) {
  const { data, isLoading, error } = useQuery<string>({
    queryKey: queryKeys.branchDiff(session.id),
    queryFn: () =>
      invoke("get_branch_diff", {
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
  });

  useEscapeKey(onClose);

  const files = data ? parseDiff(data) : [];
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const scrollToFile = useCallback((path: string) => {
    const el = fileRefs.current.get(path);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
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

  return (
    <Modal onClose={onClose} className="diff-modal-content">
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
    </Modal>
  );
}
