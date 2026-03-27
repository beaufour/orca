import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddSessionBar } from "./AddSessionBar";
import type { Session } from "../types";

// Mock tauri invoke
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

const defaultProps = {
  repoPath: "/repo",
  groupPath: "/group",
  groupName: "test-group",
  isGitRepo: true,
  worktreeCommand: null,
  componentDepth: 0,
  backend: "local" as const,
  createSession: vi.fn(),
  pendingCreations: new Map(),
};

describe("AddSessionBar restart all", () => {
  it("shows Restart All button when there are dead sessions", () => {
    const sessions = [
      makeSession({ id: "s1", tmux_session: "tmux_s1", worktree_branch: "main" }),
      makeSession({ id: "s2", tmux_session: "tmux_s2", worktree_branch: "feat" }),
    ];
    // Only s1 is alive
    const liveTmux = new Set(["tmux_s1"]);

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    expect(screen.getByText("Restart All (1)")).toBeInTheDocument();
  });

  it("hides Restart All button when all sessions are alive", () => {
    const sessions = [
      makeSession({ id: "s1", tmux_session: "tmux_s1", worktree_branch: "main" }),
      makeSession({ id: "s2", tmux_session: "tmux_s2", worktree_branch: "feat" }),
    ];
    const liveTmux = new Set(["tmux_s1", "tmux_s2"]);

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    expect(screen.queryByText(/Restart All/)).not.toBeInTheDocument();
  });

  it("hides Restart All button when sessions have no tmux_session", () => {
    const sessions = [makeSession({ id: "s1", tmux_session: "", worktree_branch: "main" })];
    const liveTmux = new Set<string>();

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    expect(screen.queryByText(/Restart All/)).not.toBeInTheDocument();
  });

  it("calls restart_all_sessions with resume when clicked", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const sessions = [makeSession({ id: "s1", tmux_session: "tmux_s1", worktree_branch: "feat" })];
    const liveTmux = new Set<string>();

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Restart All (1)"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("restart_all_sessions", {
        groupPath: "/group",
        resume: true,
      });
    });
  });

  it("shows correct count for multiple dead sessions", () => {
    const sessions = [
      makeSession({ id: "s1", tmux_session: "tmux_s1", worktree_branch: "feat-a" }),
      makeSession({ id: "s2", tmux_session: "tmux_s2", worktree_branch: "feat-b" }),
      makeSession({ id: "s3", tmux_session: "tmux_s3", worktree_branch: "feat-c" }),
    ];
    // All dead
    const liveTmux = new Set<string>();

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={sessions} liveTmuxSessions={liveTmux} />
      </Wrapper>,
    );

    expect(screen.getByText("Restart All (3)")).toBeInTheDocument();
  });

  it("hides Restart All for remote backends", () => {
    const sessions = [makeSession({ id: "s1", tmux_session: "tmux_s1", worktree_branch: "feat" })];
    const liveTmux = new Set<string>();

    render(
      <Wrapper>
        <AddSessionBar
          {...defaultProps}
          backend="claude-remote"
          sessions={sessions}
          liveTmuxSessions={liveTmux}
        />
      </Wrapper>,
    );

    expect(screen.queryByText(/Restart All/)).not.toBeInTheDocument();
  });
});
