import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RestartAllBar } from "./RestartAllBar";
import type { Session } from "../types";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

afterEach(() => {
  cleanup();
  mockInvoke.mockReset();
});

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    title: overrides.id,
    project_path: "/proj",
    group_path: "/group",
    sort_order: 0,
    status: "running",
    tmux_session: "",
    created_at: 0,
    last_accessed: 0,
    worktree_path: "",
    worktree_repo: "",
    worktree_branch: "",
    claude_session_id: null,
    prompt: null,
    pr_url: null,
    pr_number: null,
    pr_state: null,
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("RestartAllBar", () => {
  it("shows button when there are dead sessions", () => {
    const sessions = [
      makeSession({ id: "s1", tmux_session: "tmux_s1" }),
      makeSession({ id: "s2", tmux_session: "tmux_s2" }),
    ];
    const liveTmux = new Set(["tmux_s1"]);

    render(
      <Wrapper>
        <RestartAllBar sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    expect(screen.getByText("Restart All (1)")).toBeInTheDocument();
  });

  it("renders nothing when all sessions are alive", () => {
    const sessions = [makeSession({ id: "s1", tmux_session: "tmux_s1" })];
    const liveTmux = new Set(["tmux_s1"]);

    const { container } = render(
      <Wrapper>
        <RestartAllBar sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("calls restart_all_sessions without groupPath for all sessions", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const sessions = [makeSession({ id: "s1", tmux_session: "tmux_s1" })];
    const liveTmux = new Set<string>();

    render(
      <Wrapper>
        <RestartAllBar sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Restart All (1)"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("restart_all_sessions", {
        groupPath: null,
        resume: true,
      });
    });
  });
});
