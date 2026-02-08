import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { AttentionCounts, Group } from "../types";

interface SidebarProps {
  selectedGroupPath: string | null;
  needsActionActive: boolean;
  onSelectGroup: (group: Group | null) => void;
  onSelectNeedsAction: () => void;
  onCreateGroup: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
}

export function Sidebar({
  selectedGroupPath,
  needsActionActive,
  onSelectGroup,
  onSelectNeedsAction,
  onCreateGroup,
  collapsed,
  onToggleCollapse,
  width,
}: SidebarProps) {
  const {
    data: groups,
    isLoading,
    error,
    refetch,
  } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: () => invoke("get_groups"),
    refetchInterval: 10_000,
  });

  const { data: attentionCounts } = useQuery<AttentionCounts>({
    queryKey: ["attention_counts"],
    queryFn: () => invoke("get_attention_counts"),
    refetchInterval: 5_000,
  });

  return (
    <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`} style={{ width }}>
      <div className="sidebar-header">
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
            {(attentionCounts?.total ?? 0) > 0 && (
              <span className="attention-count">{attentionCounts!.total}</span>
            )}
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
              {attentionCounts?.groups[group.path] && (
                <span
                  className={`attention-dot attention-dot-${attentionCounts.groups[group.path]}`}
                />
              )}
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
