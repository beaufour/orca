import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types";
import type { DiffComment, DiffHunk } from "../utils";
import { parseDiff, fileName, fileDir, formatCommentsAsPrompt } from "../utils";
import { queryKeys } from "../queryKeys";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { Modal } from "./Modal";

interface DiffViewerProps {
  session: Session;
  tmuxSession: string | null;
  onClose: () => void;
}

interface LineSelection {
  filePath: string;
  hunkIndex: number;
  startLine: number;
  endLine: number | null;
}

let nextCommentId = 1;

export function DiffViewer({ session, tmuxSession, onClose }: DiffViewerProps) {
  const { data, isLoading, error } = useQuery<string>({
    queryKey: queryKeys.branchDiff(session.id),
    queryFn: () =>
      invoke("get_branch_diff", {
        worktreePath: session.worktree_path,
        branch: session.worktree_branch,
      }),
  });

  const [comments, setComments] = useState<DiffComment[]>([]);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [activeCommentInput, setActiveCommentInput] = useState<{
    filePath: string;
    hunkIndex: number;
    endLine: number;
  } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);

  const guardedClose = useCallback(() => {
    if (comments.length > 0) {
      setConfirmingClose(true);
    } else {
      onClose();
    }
  }, [comments.length, onClose]);

  useEscapeKey(() => {
    if (confirmingClose) {
      setConfirmingClose(false);
    } else if (editingCommentId !== null) {
      setEditingCommentId(null);
    } else if (activeCommentInput) {
      cancelComment();
    } else {
      guardedClose();
    }
  });

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

  const handleLineClick = (filePath: string, hunkIndex: number, lineIndex: number) => {
    // If textarea is open, cancel it and start a new selection
    if (activeCommentInput) {
      cancelComment();
    }

    if (
      selection &&
      selection.filePath === filePath &&
      selection.hunkIndex === hunkIndex &&
      selection.endLine === null
    ) {
      // Second click in same hunk: complete the range
      const start = Math.min(selection.startLine, lineIndex);
      const end = Math.max(selection.startLine, lineIndex);
      setSelection({ filePath, hunkIndex, startLine: start, endLine: end });
      setActiveCommentInput({ filePath, hunkIndex, endLine: end });
      setCommentText("");
    } else {
      // First click or different hunk/file: start new selection
      setSelection({ filePath, hunkIndex, startLine: lineIndex, endLine: null });
    }
  };

  const addComment = (hunk: DiffHunk) => {
    if (!selection || selection.endLine === null || !commentText.trim()) return;

    const start = selection.startLine;
    const end = selection.endLine;
    const lines = hunk.lines.slice(start, end + 1);

    setComments((prev) => [
      ...prev,
      {
        id: nextCommentId++,
        filePath: selection.filePath,
        hunkIndex: selection.hunkIndex,
        startLine: start,
        endLine: end,
        text: commentText.trim(),
        lines,
      },
    ]);

    setSelection(null);
    setActiveCommentInput(null);
    setCommentText("");
  };

  const cancelComment = () => {
    setSelection(null);
    setActiveCommentInput(null);
    setCommentText("");
  };

  const deleteComment = (commentId: number) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    if (editingCommentId === commentId) setEditingCommentId(null);
  };

  const startEditing = (comment: DiffComment) => {
    setEditingCommentId(comment.id);
    setEditText(comment.text);
  };

  const saveEdit = () => {
    if (editingCommentId === null) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      deleteComment(editingCommentId);
    } else {
      setComments((prev) =>
        prev.map((c) => (c.id === editingCommentId ? { ...c, text: trimmed } : c)),
      );
    }
    setEditingCommentId(null);
  };

  const clearAllComments = () => {
    setComments([]);
    setSelection(null);
    setActiveCommentInput(null);
    setCommentText("");
  };

  const sendComments = async () => {
    if (!tmuxSession || comments.length === 0) return;
    const prompt = formatCommentsAsPrompt(comments);
    try {
      await invoke("paste_to_tmux_pane", { tmuxSession, text: prompt });
      // Brief pause so the TUI processes the pasted text before submitting
      await new Promise((resolve) => setTimeout(resolve, 200));
      await invoke("send_key_to_tmux", { tmuxSession, key: "Enter" });
      onClose();
    } catch (err) {
      console.error("Failed to send comments to tmux:", err);
    }
  };

  const isLineSelected = (filePath: string, hunkIndex: number, lineIndex: number): boolean => {
    if (!selection || selection.filePath !== filePath || selection.hunkIndex !== hunkIndex)
      return false;
    if (selection.endLine === null) return lineIndex === selection.startLine;
    return lineIndex >= selection.startLine && lineIndex <= selection.endLine;
  };

  const isLineCommented = (filePath: string, hunkIndex: number, lineIndex: number): boolean => {
    return comments.some(
      (c) =>
        c.filePath === filePath &&
        c.hunkIndex === hunkIndex &&
        lineIndex >= c.startLine &&
        lineIndex <= c.endLine,
    );
  };

  const getCommentsAfterLine = (
    filePath: string,
    hunkIndex: number,
    lineIndex: number,
  ): DiffComment[] => {
    return comments.filter(
      (c) => c.filePath === filePath && c.hunkIndex === hunkIndex && c.endLine === lineIndex,
    );
  };

  const fileCommentCount = (filePath: string): number => {
    return comments.filter((c) => c.filePath === filePath).length;
  };

  return (
    <Modal onClose={guardedClose} className="diff-modal-content">
      <div className="diff-header">
        <div className="diff-header-title">
          <span>Diff: {session.worktree_branch}</span>
          {files.length > 0 && (
            <span className="diff-file-count">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
          )}
          {comments.length > 0 && (
            <span className="diff-comment-count">
              {comments.length} comment{comments.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="diff-header-actions">
          {confirmingClose ? (
            <>
              <span className="diff-close-confirm-text">
                Discard {comments.length} unsent comment{comments.length !== 1 ? "s" : ""}?
              </span>
              <button className="wt-btn wt-btn-danger" onClick={onClose}>
                Discard
              </button>
              <button className="wt-btn" onClick={() => setConfirmingClose(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {comments.length > 0 && (
                <>
                  {tmuxSession && (
                    <button className="wt-btn wt-btn-add" onClick={sendComments}>
                      Send {comments.length} comment{comments.length !== 1 ? "s" : ""} to Claude
                    </button>
                  )}
                  <button className="wt-btn wt-btn-danger" onClick={clearAllComments}>
                    Clear All
                  </button>
                </>
              )}
              <button className="wt-btn" onClick={guardedClose}>
                Close
              </button>
            </>
          )}
        </div>
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
                  {fileCommentCount(file.path) > 0 && (
                    <span className="diff-file-comment-badge">{fileCommentCount(file.path)}</span>
                  )}
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
                  {hunk.lines.map((line, li) => {
                    const selected = isLineSelected(file.path, hi, li);
                    const commented = isLineCommented(file.path, hi, li);
                    const lineComments = getCommentsAfterLine(file.path, hi, li);
                    const showInput =
                      activeCommentInput &&
                      activeCommentInput.filePath === file.path &&
                      activeCommentInput.hunkIndex === hi &&
                      activeCommentInput.endLine === li;

                    return (
                      <div key={li}>
                        <div
                          className={`diff-line diff-line-${line.type}${selected ? " diff-line-selected" : ""}${commented ? " diff-line-commented" : ""}`}
                          onClick={() => handleLineClick(file.path, hi, li)}
                        >
                          <span className="diff-line-gutter">{commented ? "\u{1f4ac}" : ""}</span>
                          <span className="diff-line-content">{line.content}</span>
                        </div>
                        {lineComments.map((c) => (
                          <div key={c.id} className="diff-comment-display">
                            {editingCommentId === c.id ? (
                              <div className="diff-comment-edit-row">
                                <textarea
                                  className="diff-comment-textarea"
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      e.stopPropagation();
                                      setEditingCommentId(null);
                                    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                      e.preventDefault();
                                      saveEdit();
                                    }
                                  }}
                                  autoFocus
                                  rows={3}
                                />
                                <div className="diff-comment-input-actions">
                                  <button
                                    className="wt-btn wt-btn-add"
                                    onClick={saveEdit}
                                    disabled={!editText.trim()}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="wt-btn"
                                    onClick={() => setEditingCommentId(null)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="wt-btn wt-btn-danger"
                                    onClick={() => deleteComment(c.id)}
                                  >
                                    Delete
                                  </button>
                                  <span className="diff-comment-shortcut-hint">
                                    {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter
                                    to save
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div
                                  className="diff-comment-text"
                                  onClick={() => startEditing(c)}
                                  title="Click to edit"
                                >
                                  {c.text}
                                </div>
                                <button
                                  className="diff-comment-delete"
                                  onClick={() => deleteComment(c.id)}
                                  title="Delete comment"
                                >
                                  x
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                        {showInput && (
                          <div className="diff-comment-input-row">
                            <textarea
                              className="diff-comment-textarea"
                              value={commentText}
                              onChange={(e) => setCommentText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.stopPropagation();
                                  cancelComment();
                                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  addComment(hunk);
                                }
                              }}
                              placeholder="Write a comment..."
                              autoFocus
                              rows={3}
                            />
                            <div className="diff-comment-input-actions">
                              <button
                                className="wt-btn wt-btn-add"
                                onClick={() => addComment(hunk)}
                                disabled={!commentText.trim()}
                              >
                                Add Comment
                              </button>
                              <button className="wt-btn" onClick={cancelComment}>
                                Cancel
                              </button>
                              <span className="diff-comment-shortcut-hint">
                                {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to
                                submit
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
