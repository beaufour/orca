import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
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
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { VersionWarning } from "./components/VersionWarning";
import { UpdateNotification } from "./components/UpdateNotification";
import type { Group, Session } from "./types";
import { isMainSession, storageGet, storageSet } from "./utils";
import { queryKeys } from "./queryKeys";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useDebouncedValue } from "./hooks/useDebouncedValue";

const SELECTED_VIEW_KEY = "orca-selected-view";
const VIEW_NEEDS_ACTION = "__needs_action__";
const VIEW_ALL = "__all__";

const initialSavedView = storageGet(SELECTED_VIEW_KEY);

function App() {
  const savedView = useRef(initialSavedView);
  const initialRestoreDone = useRef(false);

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [needsActionFilter, setNeedsActionFilter] = useState(
    initialSavedView === VIEW_NEEDS_ACTION,
  );
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 150);
  const [searchVisible, setSearchVisible] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [movingSession, setMovingSession] = useState<Session | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<Group | null>(null);
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

  // Check agent-deck version on mount
  useEffect(() => {
    invoke<{ supported: string; installed: string }>("check_agent_deck_version")
      .then(async ({ supported, installed }) => {
        if (supported !== installed) {
          const stored = storageGet("orca-version-warning-dismissed");
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

  const addSessionBarRef = useRef<AddSessionBarHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    data: sessions,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery<Session[]>({
    queryKey: needsActionFilter
      ? queryKeys.attentionSessions
      : queryKeys.sessions(selectedGroup?.path ?? null),
    queryFn: () =>
      needsActionFilter
        ? invoke("get_attention_sessions")
        : invoke("get_sessions", {
            groupPath: selectedGroup?.path ?? undefined,
          }),
    refetchInterval: 3_000,
  });

  const { data: groups } = useQuery<Group[]>({
    queryKey: queryKeys.groups,
    queryFn: () => invoke("get_groups"),
  });

  const { data: liveTmuxSessions } = useQuery<string[]>({
    queryKey: queryKeys.tmuxSessions,
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

  // Derive up-to-date selectedGroup from latest groups query data
  // (e.g., after toggling github_issues_enabled in settings)
  const effectiveGroup = useMemo(() => {
    if (!selectedGroup || !groups) return selectedGroup;
    return groups.find((g) => g.path === selectedGroup.path) ?? selectedGroup;
  }, [selectedGroup, groups]);

  // Derive up-to-date selectedSession from latest sessions query data
  // (e.g., after restart updates tmux_session)
  const effectiveSession = useMemo(() => {
    if (!selectedSession || !sessions) return selectedSession;
    return sessions.find((s) => s.id === selectedSession.id) ?? selectedSession;
  }, [selectedSession, sessions]);

  const filteredSessions = useMemo(() => {
    if (!sessions) return undefined;
    let list = sessions;
    // Hide dismissed sessions from Needs Action view
    if (needsActionFilter) {
      list = list.filter((s) => !dismissedIds.has(s.id));
    }
    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.project_path.toLowerCase().includes(q) ||
          (s.worktree_branch && s.worktree_branch.toLowerCase().includes(q)),
      );
    }
    // Main session (no worktree, or on main/master branch) always first
    return [...list].sort((a, b) => {
      const aMain = isMainSession(a.worktree_branch);
      const bMain = isMainSession(b.worktree_branch);
      if (aMain !== bMain) return aMain ? -1 : 1;
      return 0;
    });
  }, [sessions, debouncedSearchQuery, needsActionFilter, dismissedIds]);

  // Sidebar resize
  const { sidebarWidth, sidebarCollapsed, setSidebarCollapsed, isResizing, handleMouseDown } =
    useSidebarResize();

  const terminalOpen = selectedSession !== null;

  // Wrap setFocusedIndex to also clear confirming remove state
  const updateFocusedIndex: typeof setFocusedIndex = useCallback((value) => {
    setFocusedIndex(value);
    setConfirmingRemoveId(null);
  }, []);

  // Derive clamped focused index from session count
  const clampedFocusedIndex = useMemo(() => {
    if (!filteredSessions) return focusedIndex;
    if (focusedIndex >= filteredSessions.length) {
      return Math.max(filteredSessions.length - 1, -1);
    }
    return focusedIndex;
  }, [focusedIndex, filteredSessions]);

  // Keyboard shortcuts
  useKeyboardShortcuts(
    {
      terminalOpen,
      filteredSessions,
      focusedIndex: clampedFocusedIndex,
      searchVisible,
      showShortcutHelp,
      showLogViewer,
      showIssueModal,
      settingsGroup,
      confirmingRemoveId,
      renamingSession,
      movingSession,
      showCreateGroup,
      selectedGroup: effectiveGroup,
      needsActionFilter,
      groups,
    },
    {
      setFocusedIndex: updateFocusedIndex,
      setSelectedSession,
      setSelectedGroup,
      setNeedsActionFilter,
      setSearchQuery,
      setSearchVisible,
      setShowShortcutHelp,
      setShowLogViewer,
      setShowIssueModal,
      setSettingsGroup,
      setConfirmingRemoveId,
      setRenamingSession,
      setMovingSession,
      setShowCreateGroup,
      handleDismiss,
      addSessionBarRef,
      searchInputRef,
    },
  );

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
      storageSet(SELECTED_VIEW_KEY, VIEW_NEEDS_ACTION);
    } else if (selectedGroup) {
      storageSet(SELECTED_VIEW_KEY, selectedGroup.path);
    } else {
      storageSet(SELECTED_VIEW_KEY, VIEW_ALL);
    }
  }, [selectedGroup, needsActionFilter]);

  return (
    <div className={`app-layout ${isResizing ? "is-resizing" : ""}`}>
      <Sidebar
        selectedGroupPath={effectiveGroup?.path ?? null}
        needsActionActive={needsActionFilter}
        onSelectGroup={(g) => {
          setSelectedGroup(g);
          setSelectedSession(null);
          setNeedsActionFilter(false);
          updateFocusedIndex(0);
        }}
        onSelectNeedsAction={() => {
          setSelectedGroup(null);
          setSelectedSession(null);
          setNeedsActionFilter(true);
          updateFocusedIndex(0);
        }}
        onCreateGroup={() => setShowCreateGroup(true)}
        onOpenSettings={(g) => setSettingsGroup(g)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        width={sidebarWidth}
        dismissedIds={dismissedIds}
      />
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="main-area">
        {terminalOpen ? (
          <TerminalView session={effectiveSession} onClose={() => setSelectedSession(null)} />
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
              {effectiveGroup && !needsActionFilter && effectiveGroup.github_issues_enabled ? (
                <TodoList
                  group={effectiveGroup}
                  sessions={filteredSessions}
                  onSelectSession={setSelectedSession}
                  liveTmuxSessions={liveTmuxSet}
                  sessionsLoading={sessionsLoading}
                  sessionsError={sessionsError}
                  onRetry={() => refetchSessions()}
                  confirmingRemoveId={confirmingRemoveId}
                  onConfirmingRemoveChange={setConfirmingRemoveId}
                  focusedIndex={clampedFocusedIndex}
                  refetchSessions={refetchSessions}
                />
              ) : (
                <SessionList
                  sessions={filteredSessions}
                  groupNames={needsActionFilter || !effectiveGroup ? groupNames : undefined}
                  onSelectSession={setSelectedSession}
                  selectedSessionId={null}
                  focusedIndex={clampedFocusedIndex}
                  isLoading={sessionsLoading}
                  error={sessionsError}
                  onRetry={() => refetchSessions()}
                  confirmingRemoveId={confirmingRemoveId}
                  onConfirmingRemoveChange={setConfirmingRemoveId}
                  groupPath={effectiveGroup?.path}
                  repoPath={effectiveGroup?.default_path}
                  liveTmuxSessions={liveTmuxSet}
                  dismissedIds={dismissedIds}
                  onDismiss={handleDismiss}
                  onUndismiss={handleUndismiss}
                />
              )}
            </main>
            {effectiveGroup && (
              <AddSessionBar
                ref={addSessionBarRef}
                repoPath={effectiveGroup.default_path}
                groupPath={effectiveGroup.path}
                groupName={effectiveGroup.name}
                sessions={sessions ?? []}
                onSessionCreated={async (sessionId) => {
                  const { data } = await refetchSessions();
                  const newSession = data?.find((s) => s.id === sessionId);
                  if (newSession) {
                    setSelectedSession(newSession);
                  }
                }}
              />
            )}
          </>
        )}
      </div>
      {showShortcutHelp && <ShortcutHelp onClose={() => setShowShortcutHelp(false)} />}
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
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}
      {showIssueModal && effectiveGroup && (
        <IssueModal
          mode="create"
          repoPath={effectiveGroup.default_path}
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
