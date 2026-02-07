import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Group } from "../types";

interface SidebarProps {
  selectedGroupPath: string | null;
  onSelectGroup: (group: Group | null) => void;
}

export function Sidebar({ selectedGroupPath, onSelectGroup }: SidebarProps) {
  const { data: groups, isLoading, error } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: () => invoke("get_groups"),
    refetchInterval: 10_000,
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Orca</h1>
      </div>
      <nav className="sidebar-nav">
        <button
          className={`sidebar-item ${selectedGroupPath === null ? "active" : ""}`}
          onClick={() => onSelectGroup(null)}
        >
          All Sessions
        </button>
        {isLoading && <div className="sidebar-loading">Loading...</div>}
        {error && (
          <div className="sidebar-error">
            Failed to load groups
          </div>
        )}
        {groups?.map((group) => (
          <button
            key={group.path}
            className={`sidebar-item ${selectedGroupPath === group.path ? "active" : ""}`}
            onClick={() => onSelectGroup(group)}
          >
            {group.name}
          </button>
        ))}
      </nav>
    </aside>
  );
}
