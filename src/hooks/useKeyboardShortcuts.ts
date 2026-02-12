import { useEffect, useRef, useCallback } from "react";
import type { Group, Session } from "../types";
import type { AddSessionBarHandle } from "../components/AddSessionBar";

interface KeyboardState {
  terminalOpen: boolean;
  filteredSessions: Session[] | undefined;
  focusedIndex: number;
  searchVisible: boolean;
  showShortcutHelp: boolean;
  showLogViewer: boolean;
  showIssueModal: boolean;
  settingsGroup: Group | null;
  confirmingRemoveId: string | null;
  renamingSession: Session | null;
  movingSession: Session | null;
  showCreateGroup: boolean;
  selectedGroup: Group | null;
  needsActionFilter: boolean;
  groups: Group[] | undefined;
}

interface KeyboardActions {
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedSession: (s: Session | null) => void;
  setSelectedGroup: (g: Group | null) => void;
  setNeedsActionFilter: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setSearchVisible: (v: boolean) => void;
  setShowShortcutHelp: (v: boolean) => void;
  setShowLogViewer: (v: boolean) => void;
  setShowIssueModal: (v: boolean) => void;
  setSettingsGroup: (g: Group | null) => void;
  setConfirmingRemoveId: (id: string | null) => void;
  setRenamingSession: (s: Session | null) => void;
  setMovingSession: (s: Session | null) => void;
  setShowCreateGroup: (v: boolean) => void;
  handleDismiss: (sessionId: string) => void;
  addSessionBarRef: React.RefObject<AddSessionBarHandle | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useKeyboardShortcuts(state: KeyboardState, actions: KeyboardActions) {
  const stateRef = useRef(state);
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref to avoid stale closures in keyboard handler
  stateRef.current = state;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const {
        terminalOpen,
        filteredSessions,
        focusedIndex,
        searchVisible,
        showShortcutHelp,
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
      } = stateRef.current;

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
            actions.setSearchQuery("");
            actions.setSearchVisible(false);
          }
          target.blur();
        }
        return;
      }

      // Modal guard: only Escape works when a modal is open
      const anyModalOpen =
        showShortcutHelp ||
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
            actions.setFocusedIndex((prev) => Math.min(prev + 1, count - 1));
          }
          break;
        case "k":
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          if (count > 0) {
            actions.setFocusedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            actions.setSelectedSession(filteredSessions[focusedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          if (showShortcutHelp) {
            actions.setShowShortcutHelp(false);
          } else if (showLogViewer) {
            actions.setShowLogViewer(false);
          } else if (showIssueModal) {
            actions.setShowIssueModal(false);
          } else if (settingsGroup !== null) {
            actions.setSettingsGroup(null);
          } else if (showCreateGroup) {
            actions.setShowCreateGroup(false);
          } else if (movingSession !== null) {
            actions.setMovingSession(null);
          } else if (renamingSession !== null) {
            actions.setRenamingSession(null);
          } else if (confirmingRemoveId !== null) {
            actions.setConfirmingRemoveId(null);
          } else if (searchVisible) {
            actions.setSearchQuery("");
            actions.setSearchVisible(false);
          } else {
            actions.setFocusedIndex(-1);
          }
          break;
        case "n":
          e.preventDefault();
          actions.addSessionBarRef.current?.toggleForm();
          break;
        case "/":
          e.preventDefault();
          actions.setSearchVisible(true);
          setTimeout(() => actions.searchInputRef.current?.focus(), 0);
          break;
        case "d":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            actions.setConfirmingRemoveId(filteredSessions[focusedIndex].id);
          }
          break;
        case "x":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            actions.handleDismiss(filteredSessions[focusedIndex].id);
          }
          break;
        case "R":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count) {
            actions.setRenamingSession(filteredSessions[focusedIndex]);
          }
          break;
        case "m":
          e.preventDefault();
          if (filteredSessions && focusedIndex >= 0 && focusedIndex < count && groups) {
            actions.setMovingSession(filteredSessions[focusedIndex]);
          }
          break;
        case "i":
          e.preventDefault();
          if (selectedGroup && !needsActionFilter && selectedGroup.github_issues_enabled) {
            actions.setShowIssueModal(true);
          }
          break;
        case "g":
          e.preventDefault();
          actions.setShowCreateGroup(true);
          break;
        case "L":
          e.preventDefault();
          actions.setShowLogViewer(true);
          break;
        case "?":
          e.preventDefault();
          actions.setShowShortcutHelp(true);
          break;
        case "0":
          e.preventDefault();
          actions.setSelectedGroup(null);
          actions.setSelectedSession(null);
          actions.setNeedsActionFilter(true);
          actions.setFocusedIndex(0);
          break;
        case "1":
          e.preventDefault();
          actions.setSelectedGroup(null);
          actions.setSelectedSession(null);
          actions.setNeedsActionFilter(false);
          actions.setFocusedIndex(0);
          break;
        default:
          if (e.key >= "2" && e.key <= "9" && groups) {
            const idx = parseInt(e.key) - 2;
            if (idx < groups.length) {
              e.preventDefault();
              actions.setSelectedGroup(groups[idx]);
              actions.setSelectedSession(null);
              actions.setNeedsActionFilter(false);
              actions.setFocusedIndex(0);
            }
          }
          break;
      }
    },
    [actions],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
