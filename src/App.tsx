import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { SessionList } from "./components/SessionList";
import { AddSessionBar } from "./components/AddSessionBar";
import { TerminalView } from "./components/TerminalView";
import type { Group, Session } from "./types";

function App() {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ["sessions", selectedGroup?.path ?? null],
    queryFn: () =>
      invoke("get_sessions", {
        groupPath: selectedGroup?.path ?? undefined,
      }),
    refetchInterval: 3_000,
  });

  return (
    <div className="app-layout">
      <Sidebar
        selectedGroupPath={selectedGroup?.path ?? null}
        onSelectGroup={(g) => {
          setSelectedGroup(g);
          setSelectedSession(null);
        }}
      />
      <div className="main-area">
        <main className="main-content">
          <SessionList
            sessions={sessions}
            onSelectSession={setSelectedSession}
            selectedSessionId={selectedSession?.id ?? null}
          />
        </main>
        {selectedSession && (
          <TerminalView
            session={selectedSession}
            onClose={() => setSelectedSession(null)}
          />
        )}
        {selectedGroup && (
          <AddSessionBar
            repoPath={selectedGroup.default_path}
            groupPath={selectedGroup.path}
            groupName={selectedGroup.name}
            sessions={sessions ?? []}
          />
        )}
      </div>
    </div>
  );
}

export default App;
