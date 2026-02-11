import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { SessionList } from "./components/SessionList";
import { TodoList } from "./components/TodoList";
import { AddSessionBar, type AddSessionBarHandle } from "./components/AddSessionBar";
import { TerminalView } from "./components/TerminalView";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { LogViewer } from "./components/LogViewer";
import { RenameModal } from "./components/RenameModal";
import { MoveSessionModal } from "./components/MoveSessionModal";
import { CreateGroupModal } from "./components/CreateGroupModal";
import { IssueModal } from "./components/IssueModal";
import { GroupSettingsModal } from "./components/GroupSettingsModal";
import { AboutDialog } from "./components/AboutDialog";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { VersionWarning } from "./components/VersionWarning";
import { UpdateNotification } from "./components/UpdateNotification";
import { useSessionCreation } from "./hooks/useSessionCreation";
import type { Group, Session } from "./types";

const MIN_SIDEBAR_WIDTH = 48;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 260;
const COLLAPSED_SIDEBAR_WIDTH = 48;

const SELECTED_VIEW_KEY = "orca-selected-view";
const VIEW_NEEDS_ACTION = "__needs_action__";
const VIEW_ALL = "__all__";

const initialSavedView = localStorage.getItem(SELECTED_VIEW_KEY);

function App() {
  const savedView = useRef(initialSavedView);
  const initialRestoreDone = useRef(false);

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [needsActionFilter, setNeedsActionFilter] = useState(
    initialSavedView === VIEW_NEEDS_ACTION,
  );
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [movingSession, setMovingSession] = useState<Session | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [pendingGroupSelect, setPendingGroupSelect] = useState<string | null>(null);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<Group | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [versionMismatch, setVersionMismatch] = useState<{
    supported: string;
    installed: string;
  } | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const handleDismiss = useCallback((sessionId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const handleUndismiss = useCallback((sessionId: string) => {
    setDismissedIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const selectedGroupRef = useRef(selectedGroup);
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  });

  const { pendingCreations, createSession, dismissPending } = useSessionCreation({
    onCreated: async (_creationId, sessionId) => {
      const { data } = await refetchSessions();
      const newSession = data?.find((s) => s.id === sessionId);
      // Only auto-open if the user is still viewing the group where the session was created
      if (newSession && newSession.group_path === selectedGroupRef.current?.path) {
        setSelectedSession(newSession);
      }
    },
  });

  // Listen for "show-about" menu event from native menu
  useEffect(() => {
    const unlisten = listen("show-about", () => setShowAbout(true));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Check agent-deck version on mount
  useEffect(() => {
    invoke<{ supported: string; installed: string }>("check_agent_deck_version")
      .then(async ({ supported, installed }) => {
        if (supported !== installed) {
          const stored = localStorage.getItem("orca-version-warning-dismissed");
          const appVersion = await getVersion();
          if (stored !== `${appVersion}:${installed}`) {
            setVersionMismatch({ supported, installed });
          }
        }
      })
      .catch((err) => {
        console.warn("Failed to check agent-deck version:", err);
      });
  }, []);

  // Check for app updates on mount
  useEffect(() => {
    check()
      .then((update) => {
        if (update) {
          setPendingUpdate(update);
        }
      })
      .catch((err) => {
        console.warn("Failed to check for updates:", err);
      });
  }, []);

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

  const { data: liveTmuxSessions } = useQuery<string[]>({
    queryKey: ["tmuxSessions"],
    queryFn: () => invoke("list_tmux_sessions"),
    refetchInterval: 5_000,
  });

  const liveTmuxSet = useMemo(() => new Set(liveTmuxSessions ?? []), [liveTmuxSessions]);

  const groupNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups ?? []) {
      map[g.path] = g.name;
    }
    return map;
  }, [groups]);

  // Keep selectedGroup in sync with latest groups data
  // (e.g., after toggling github_issues_enabled in settings)
  useEffect(() => {
    if (selectedGroup && groups) {
      const updated = groups.find((g) => g.path === selectedGroup.path);
      if (
        updated &&
        (updated.github_issues_enabled !== selectedGroup.github_issues_enabled ||
          updated.is_git_repo !== selectedGroup.is_git_repo ||
          updated.merge_workflow !== selectedGroup.merge_workflow)
      ) {
        setSelectedGroup(updated);
      }
    }
  }, [groups, selectedGroup]);

  // Auto-select a newly created group once it appears in the groups list
  useEffect(() => {
    if (pendingGroupSelect && groups) {
      const newGroup = groups.find((g) => g.name === pendingGroupSelect);
      if (newGroup) {
        setSelectedGroup(newGroup);
        setNeedsActionFilter(false);
        setPendingGroupSelect(null);
      }
    }
  }, [pendingGroupSelect, groups]);

  // Keep selectedSession in sync with latest query data
  // (e.g., after restart updates tmux_session)
  useEffect(() => {
    if (selectedSession && sessions) {
      const updated = sessions.find((s) => s.id === selectedSession.id);
      if (updated && updated.tmux_session !== selectedSession.tmux_session) {
        setSelectedSession(updated);
      }
    }
  }, [sessions, selectedSession]);

  const filteredSessions = useMemo(() => {
    if (!sessions) return undefined;
    let list = sessions;
    // Hide dismissed sessions from Needs Action view
    if (needsActionFilter) {
      list = list.filter((s) => !dismissedIds.has(s.id));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.project_path.toLowerCase().includes(q) ||
          (s.worktree_branch && s.worktree_branch.toLowerCase().includes(q)),
      );
    }
    // Main session (no worktree, or on main/master branch) always first
    return [...list].sort((a, b) => {
      const aMain =
        !a.worktree_branch || a.worktree_branch === "main" || a.worktree_branch === "master";
      const bMain =
        !b.worktree_branch || b.worktree_branch === "main" || b.worktree_branch === "master";
      if (aMain !== bMain) return aMain ? -1 : 1;
      return 0;
    });
  }, [sessions, searchQuery, needsActionFilter, dismissedIds]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = {
        startX: e.clientX,
        startWidth: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth,
      };
      setIsResizing(true);
    },
    [sidebarWidth, sidebarCollapsed],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta),
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
  const effectiveWidth = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth;

  // Ref to avoid stale closures in keyboard handler
  const kbStateRef = useRef({
    terminalOpen,
    filteredSessions,
    focusedIndex,
    searchVisible,
    showShortcutHelp,
    showAbout,
    showLogViewer,
    showIssueModal,
    settingsGroup,
    confirmingRemoveId,
    renamingSession,
    movingSession,
    showCreateGroup,
    selectedGroup,
    needsActionFilter,
    groups,
    dismissedIds,
  });
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref to avoid stale closures in keyboard handler
  kbStateRef.current = {
    terminalOpen,
    filteredSessions,
    focusedIndex,
    searchVisible,
    showShortcutHelp,
    showAbout,
    showLogViewer,
    showIssueModal,
    settingsGroup,
    confirmingRemoveId,
    renamingSession,
    movingSession,
    showCreateGroup,
    selectedGroup,
    needsActionFilter,
    groups,
    dismissedIds,
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        terminalOpen,
        filteredSessions,
        focusedIndex,
        searchVisible,
        showShortcutHelp,
        showAbout,
        showLogViewer,
        showIssueModal,
        settingsGroup,
        confirmingRemoveId,
        renamingSession,
        movingSession,
        showCreateGroup,
        selectedGroup,
        needsActionFilter,
        groups,
      } = kbStateRef.current;

      // When terminal is open, don't handle any shortcuts
      // (Ctrl+Q is handled inside TerminalView)
      if (terminalOpen) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

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

      // Modal guard: only Escape works when a modal is open
      const anyModalOpen =
        showShortcutHelp ||
        showAbout ||
        showLogViewer ||
        showIssueModal ||
        settingsGroup !== null ||
        confirmingRemoveId !== null ||
        renamingSession !== null ||
        movingSession !== null ||
        showCreateGroup;
      if (anyModalOpen && e.key !== "Escape") return;

      const count = filteredSessions?.length ?? 0;

      switch (e.key) {
        case "j":
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          if (count > 0) {
            setFocusedIndex((prev) => Math.min(prev + 1, count - 1));
          }
          break;
        case "k":
        case "ArrowUp":
        case "ArrowLeft":
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
          if (showShortcutHelp) {
            setShowShortcutHelp(false);
          } else if (showAbout) {
            setShowAbout(false);
          } else if (showLogViewer) {
            setShowLogViewer(false);
          } else if (showIssueModal) {
            setShowIssueModal(false);
          } else if (settingsGroup !== null) {
            setSettingsGroup(null);
          } else if (showCreateGroup) {
            setShowCreateGroup(false);
          } else if (movingSession !== null) {
            setMovingSession(null);
          } else if (renamingSession !== null) {
            setRenamingSession(null);
          } else if (confirmingRemoveId !== null) {
            setConfirmingRemoveId(null);
          } else if (searchVisible) {
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
        case "d":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            setConfirmingRemoveId(filteredSessions[focusedIndex].id);
          }
          break;
        case "x":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            handleDismiss(filteredSessions[focusedIndex].id);
          }
          break;
        case "R":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            setRenamingSession(filteredSessions[focusedIndex]);
          }
          break;
        case "m":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count && groups) {
            setMovingSession(filteredSessions[focusedIndex]);
          }
          break;
        case "i":
          e.preventDefault();
          if (
            selectedGroup &&
            !needsActionFilter &&
            selectedGroup.is_git_repo &&
            selectedGroup.github_issues_enabled
          ) {
            setShowIssueModal(true);
          }
          break;
        case "g":
          e.preventDefault();
          setShowCreateGroup(true);
          break;
        case "L":
          e.preventDefault();
          setShowLogViewer(true);
          break;
        case "?":
          e.preventDefault();
          setShowShortcutHelp(true);
          break;
        case "0":
          e.preventDefault();
          setSelectedGroup(null);
          setSelectedSession(null);
          setNeedsActionFilter(true);
          setFocusedIndex(0);
          break;
        case "1":
          e.preventDefault();
          setSelectedGroup(null);
          setSelectedSession(null);
          setNeedsActionFilter(false);
          setFocusedIndex(0);
          break;
        default:
          if (e.key >= "2" && e.key <= "9" && groups) {
            const idx = parseInt(e.key) - 2;
            if (idx < groups.length) {
              e.preventDefault();
              setSelectedGroup(groups[idx]);
              setSelectedSession(null);
              setNeedsActionFilter(false);
              setFocusedIndex(0);
            }
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleDismiss]);

  // Clear confirming remove when focus changes
  useEffect(() => {
    setConfirmingRemoveId(null);
  }, [focusedIndex]);

  // Clamp focused index when session count changes
  useEffect(() => {
    if (filteredSessions && focusedIndex >= filteredSessions.length) {
      setFocusedIndex(Math.max(filteredSessions.length - 1, -1));
    }
  }, [filteredSessions, focusedIndex]);

  // Restore selected group from localStorage once groups are loaded
  useEffect(() => {
    if (!groups) return;
    const saved = savedView.current;
    if (saved && saved !== VIEW_NEEDS_ACTION && saved !== VIEW_ALL) {
      const group = groups.find((g) => g.path === saved);
      if (group) {
        setSelectedGroup(group);
      }
    }
    initialRestoreDone.current = true;
    savedView.current = null;
  }, [groups]);

  // Persist selected view to localStorage
  useEffect(() => {
    if (!initialRestoreDone.current) return;
    if (needsActionFilter) {
      localStorage.setItem(SELECTED_VIEW_KEY, VIEW_NEEDS_ACTION);
    } else if (selectedGroup) {
      localStorage.setItem(SELECTED_VIEW_KEY, selectedGroup.path);
    } else {
      localStorage.setItem(SELECTED_VIEW_KEY, VIEW_ALL);
    }
  }, [selectedGroup, needsActionFilter]);

  return (
    <div className={`app-layout ${isResizing ? "is-resizing" : ""}`}>
      <Sidebar
        selectedGroupPath={selectedGroup?.path ?? null}
        needsActionActive={needsActionFilter}
        onSelectGroup={(g) => {
          setSelectedGroup(g);
          setSelectedSession(null);
          setNeedsActionFilter(false);
          setFocusedIndex(0);
        }}
        onSelectNeedsAction={() => {
          setSelectedGroup(null);
          setSelectedSession(null);
          setNeedsActionFilter(true);
          setFocusedIndex(0);
        }}
        onCreateGroup={() => setShowCreateGroup(true)}
        onOpenSettings={(g) => setSettingsGroup(g)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        width={effectiveWidth}
        dismissedIds={dismissedIds}
      />
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="main-area">
        {terminalOpen ? (
          <TerminalView session={selectedSession} onClose={() => setSelectedSession(null)} />
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
              {selectedGroup &&
              !needsActionFilter &&
              selectedGroup.is_git_repo &&
              selectedGroup.github_issues_enabled ? (
                <TodoList
                  group={selectedGroup}
                  sessions={filteredSessions}
                  onSelectSession={setSelectedSession}
                  liveTmuxSessions={liveTmuxSet}
                  sessionsLoading={sessionsLoading}
                  sessionsError={sessionsError}
                  onRetry={() => refetchSessions()}
                  confirmingRemoveId={confirmingRemoveId}
                  onConfirmingRemoveChange={setConfirmingRemoveId}
                  focusedIndex={focusedIndex}
                  pendingCreations={pendingCreations}
                  onDismissPending={dismissPending}
                  createSession={createSession}
                />
              ) : (
                <SessionList
                  sessions={filteredSessions}
                  groupNames={needsActionFilter || !selectedGroup ? groupNames : undefined}
                  onSelectSession={setSelectedSession}
                  selectedSessionId={null}
                  focusedIndex={focusedIndex}
                  isLoading={sessionsLoading}
                  error={sessionsError}
                  onRetry={() => refetchSessions()}
                  confirmingRemoveId={confirmingRemoveId}
                  onConfirmingRemoveChange={setConfirmingRemoveId}
                  groupPath={selectedGroup?.path}
                  repoPath={selectedGroup?.default_path}
                  liveTmuxSessions={liveTmuxSet}
                  dismissedIds={dismissedIds}
                  onDismiss={handleDismiss}
                  onUndismiss={handleUndismiss}
                  pendingCreations={pendingCreations}
                  onDismissPending={dismissPending}
                  createSession={createSession}
                  mergeWorkflow={selectedGroup?.merge_workflow}
                />
              )}
            </main>
            {selectedGroup && (
              <AddSessionBar
                ref={addSessionBarRef}
                repoPath={selectedGroup.default_path}
                groupPath={selectedGroup.path}
                groupName={selectedGroup.name}
                sessions={sessions ?? []}
                isGitRepo={selectedGroup.is_git_repo}
                createSession={createSession}
                pendingCreations={pendingCreations}
              />
            )}
          </>
        )}
      </div>
      {showShortcutHelp && <ShortcutHelp onClose={() => setShowShortcutHelp(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {renamingSession && (
        <RenameModal session={renamingSession} onClose={() => setRenamingSession(null)} />
      )}
      {movingSession && groups && (
        <MoveSessionModal
          session={movingSession}
          groups={groups}
          onClose={() => setMovingSession(null)}
        />
      )}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={(groupName) => setPendingGroupSelect(groupName)}
        />
      )}
      {showIssueModal && selectedGroup && (
        <IssueModal
          mode="create"
          repoPath={selectedGroup.default_path}
          onClose={() => setShowIssueModal(false)}
        />
      )}
      {settingsGroup && (
        <GroupSettingsModal group={settingsGroup} onClose={() => setSettingsGroup(null)} />
      )}
      {showLogViewer && <LogViewer onClose={() => setShowLogViewer(false)} />}
      {versionMismatch && (
        <VersionWarning
          supported={versionMismatch.supported}
          installed={versionMismatch.installed}
          onClose={() => setVersionMismatch(null)}
        />
      )}
      {pendingUpdate && (
        <UpdateNotification
          version={pendingUpdate.version}
          notes={pendingUpdate.body ?? ""}
          onInstall={async () => {
            await pendingUpdate.downloadAndInstall();
            await relaunch();
          }}
          onDismiss={() => setPendingUpdate(null)}
        />
      )}
    </div>
  );
}

export default App;
