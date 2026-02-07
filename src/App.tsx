import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { SessionList } from "./components/SessionList";
import { AddSessionBar, type AddSessionBarHandle } from "./components/AddSessionBar";
import { TerminalView } from "./components/TerminalView";
import type { Group, Session } from "./types";

const MIN_SIDEBAR_WIDTH = 48;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 260;
const COLLAPSED_SIDEBAR_WIDTH = 48;

function App() {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [needsActionFilter, setNeedsActionFilter] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const addSessionBarRef = useRef<AddSessionBarHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    data: sessions,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery<Session[]>({
    queryKey: needsActionFilter
      ? ["sessions", "__needs_action__"]
      : ["sessions", selectedGroup?.path ?? null],
    queryFn: () =>
      needsActionFilter
        ? invoke("get_attention_sessions")
        : invoke("get_sessions", {
            groupPath: selectedGroup?.path ?? undefined,
          }),
    refetchInterval: 3_000,
  });

  const { data: groups } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: () => invoke("get_groups"),
  });

  const filteredSessions = useMemo(() => {
    if (!sessions) return undefined;
    if (!searchQuery) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.project_path.toLowerCase().includes(q) ||
        (s.worktree_branch && s.worktree_branch.toLowerCase().includes(q))
    );
  }, [sessions, searchQuery]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = {
        startX: e.clientX,
        startWidth: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth,
      };
      setIsResizing(true);
    },
    [sidebarWidth, sidebarCollapsed]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta)
      );
      if (newWidth <= MIN_SIDEBAR_WIDTH + 20) {
        setSidebarCollapsed(true);
      } else {
        setSidebarCollapsed(false);
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const terminalOpen = selectedSession !== null;
  const effectiveWidth = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : sidebarWidth;

  // Ref to avoid stale closures in keyboard handler
  const kbStateRef = useRef({
    terminalOpen,
    filteredSessions,
    focusedIndex,
    searchVisible,
    groups,
  });
  kbStateRef.current = {
    terminalOpen,
    filteredSessions,
    focusedIndex,
    searchVisible,
    groups,
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { terminalOpen, filteredSessions, focusedIndex, searchVisible, groups } =
        kbStateRef.current;

      // When terminal is open, don't handle any shortcuts
      // (Ctrl+Q is handled inside TerminalView)
      if (terminalOpen) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInput) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (searchVisible) {
            setSearchQuery("");
            setSearchVisible(false);
          }
          target.blur();
        }
        return;
      }

      const count = filteredSessions?.length ?? 0;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          if (count > 0) {
            setFocusedIndex((prev) => Math.min(prev + 1, count - 1));
          }
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          if (count > 0) {
            setFocusedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            setSelectedSession(filteredSessions[focusedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          if (searchVisible) {
            setSearchQuery("");
            setSearchVisible(false);
          } else {
            setFocusedIndex(-1);
          }
          break;
        case "n":
          e.preventDefault();
          addSessionBarRef.current?.toggleForm();
          break;
        case "/":
          e.preventDefault();
          setSearchVisible(true);
          setTimeout(() => searchInputRef.current?.focus(), 0);
          break;
        case "0":
          e.preventDefault();
          setSelectedGroup(null);
          setSelectedSession(null);
          setNeedsActionFilter(false);
          setFocusedIndex(-1);
          break;
        default:
          if (e.key >= "1" && e.key <= "9" && groups) {
            const idx = parseInt(e.key) - 1;
            if (idx < groups.length) {
              e.preventDefault();
              setSelectedGroup(groups[idx]);
              setSelectedSession(null);
              setNeedsActionFilter(false);
              setFocusedIndex(-1);
            }
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Clamp focused index when session count changes
  useEffect(() => {
    if (filteredSessions && focusedIndex >= filteredSessions.length) {
      setFocusedIndex(Math.max(filteredSessions.length - 1, -1));
    }
  }, [filteredSessions, focusedIndex]);

  return (
    <div className={`app-layout ${isResizing ? "is-resizing" : ""}`}>
      <Sidebar
        selectedGroupPath={selectedGroup?.path ?? null}
        needsActionActive={needsActionFilter}
        onSelectGroup={(g) => {
          setSelectedGroup(g);
          setSelectedSession(null);
          setNeedsActionFilter(false);
          setFocusedIndex(-1);
        }}
        onSelectNeedsAction={() => {
          setSelectedGroup(null);
          setSelectedSession(null);
          setNeedsActionFilter(true);
          setFocusedIndex(-1);
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        width={effectiveWidth}
      />
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="main-area">
        {terminalOpen ? (
          <TerminalView
            session={selectedSession}
            onClose={() => setSelectedSession(null)}
          />
        ) : (
          <>
            <main className="main-content">
              {searchVisible && (
                <div className="search-bar">
                  <input
                    ref={searchInputRef}
                    className="search-input"
                    type="text"
                    placeholder="Search sessions... (Esc to close)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              )}
              <SessionList
                sessions={filteredSessions}
                onSelectSession={setSelectedSession}
                selectedSessionId={null}
                focusedIndex={focusedIndex}
                isLoading={sessionsLoading}
                error={sessionsError}
                onRetry={() => refetchSessions()}
              />
            </main>
            {selectedGroup && (
              <AddSessionBar
                ref={addSessionBarRef}
                repoPath={selectedGroup.default_path}
                groupPath={selectedGroup.path}
                groupName={selectedGroup.name}
                sessions={sessions ?? []}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
