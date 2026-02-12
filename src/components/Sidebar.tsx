import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group, Session } from "../types";
import { queryKeys } from "../queryKeys";
import logoSrc from "../assets/logo.png";

interface SidebarProps {
  selectedGroupPath: string | null;
  needsActionActive: boolean;
  onSelectGroup: (group: Group | null) => void;
  onSelectNeedsAction: () => void;
  onCreateGroup: () => void;
  onOpenSettings: (group: Group) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  dismissedIds?: Set<string>;
}

export function Sidebar({
  selectedGroupPath,
  needsActionActive,
  onSelectGroup,
  onSelectNeedsAction,
  onCreateGroup,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  width,
  dismissedIds,
}: SidebarProps) {
  const {
    data: groups,
    isLoading,
    error,
    refetch,
  } = useQuery<Group[]>({
    queryKey: queryKeys.groups,
    queryFn: () => invoke("get_groups"),
    refetchInterval: 10_000,
  });

  const openTerminal = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    invoke("open_in_terminal", { path });
  }, []);

  const { data: attentionSessions } = useQuery<Session[]>({
    queryKey: queryKeys.attentionSessions,
    queryFn: () => invoke("get_attention_sessions"),
    refetchInterval: 5_000,
  });

  // Compute counts and per-group dots from attention sessions, excluding dismissed
  const { total, groupDots } = useMemo(() => {
    const dots: Record<string, string> = {};
    let count = 0;
    for (const s of attentionSessions ?? []) {
      if (dismissedIds?.has(s.id)) continue;
      count++;
      // "waiting" (needs_input) takes priority over "error"
      const current = dots[s.group_path];
      if (!current || (current === "error" && s.status === "waiting")) {
        dots[s.group_path] = s.status;
      }
    }
    return { total: count, groupDots: dots };
  }, [attentionSessions, dismissedIds]);

  return (
    <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`} style={{ width }}>
      <div className="sidebar-header">
        <img src={logoSrc} alt="Orca" className="sidebar-logo" />
        {!collapsed && <h1 className="sidebar-title">Orca</h1>}
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "\u25B6" : "\u25C0"}
        </button>
      </div>
      {!collapsed && (
        <nav className="sidebar-nav">
          <button
            className={`sidebar-item sidebar-item-attention ${needsActionActive ? "active" : ""}`}
            onClick={onSelectNeedsAction}
          >
            Needs Action
            {total > 0 && <span className="attention-count">{total}</span>}
          </button>
          <button
            className={`sidebar-item ${!needsActionActive && selectedGroupPath === null ? "active" : ""}`}
            onClick={() => onSelectGroup(null)}
          >
            All Sessions
          </button>
          {isLoading && (
            <div className="sidebar-loading loading-row">
              <span className="spinner" /> Loading groups...
            </div>
          )}
          {error && (
            <div className="sidebar-error error-row">
              Failed to load groups
              <button className="retry-btn" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          )}
          {groups?.map((group) => (
            <button
              key={group.path}
              className={`sidebar-item ${!needsActionActive && selectedGroupPath === group.path ? "active" : ""}`}
              onClick={() => onSelectGroup(group)}
            >
              {group.name}
              {groupDots[group.path] && (
                <span className={`attention-dot attention-dot-${groupDots[group.path]}`} />
              )}
              <span className="sidebar-actions">
                <span
                  className="sidebar-action-btn"
                  title="Group settings"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSettings(group);
                  }}
                >
                  &#x2699;
                </span>
                <span
                  className="sidebar-action-btn"
                  title={`Open iTerm in ${group.default_path}`}
                  onClick={(e) => openTerminal(e, group.default_path)}
                >
                  &gt;_
                </span>
              </span>
            </button>
          ))}
          <button className="sidebar-item sidebar-add-group" onClick={onCreateGroup}>
            + Add Group
          </button>
        </nav>
      )}
    </aside>
  );
}
