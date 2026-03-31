import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddSessionBar } from "./AddSessionBar";
import type { GitHubPr, Session } from "../types";

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

const samplePrs: GitHubPr[] = [
  {
    number: 42,
    title: "Fix login bug",
    branch: "fix-login",
    author: "alice",
    url: "https://github.com/org/repo/pull/42",
  },
  {
    number: 99,
    title: "Add search feature",
    branch: "feat-search",
    author: "bob",
    url: "https://github.com/org/repo/pull/99",
  },
];

describe("AddSessionBar From PR mode", () => {
  it("shows From PR button in the mode toggle for git repos", () => {
    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={[]} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("+ Add Session"));
    expect(screen.getByText("From PR")).toBeInTheDocument();
  });

  it("loads and displays open PRs when From PR mode is selected", async () => {
    mockInvoke.mockResolvedValue(samplePrs);

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={[]} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("+ Add Session"));
    fireEvent.click(screen.getByText("From PR"));

    // The PR picker input should appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search PRs/)).toBeInTheDocument();
    });

    // PRs should be fetched
    expect(mockInvoke).toHaveBeenCalledWith("list_open_prs", { repoPath: "/repo" });
  });

  it("filters PRs by title and selects one", async () => {
    mockInvoke.mockResolvedValue(samplePrs);

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={[]} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("+ Add Session"));
    fireEvent.click(screen.getByText("From PR"));

    const input = await screen.findByPlaceholderText(/Search PRs/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "login" } });

    // Should show the matching PR
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });
    // Should NOT show the non-matching PR
    expect(screen.queryByText("Add search feature")).not.toBeInTheDocument();

    // Select the PR
    fireEvent.click(screen.getByText("Fix login bug"));

    // Should show the selected PR info
    await waitFor(() => {
      expect(screen.getByText("#42")).toBeInTheDocument();
    });
  });

  it("creates session with PR info when submitted", async () => {
    mockInvoke.mockResolvedValue(samplePrs);
    const createSession = vi.fn();

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={[]} createSession={createSession} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("+ Add Session"));
    fireEvent.click(screen.getByText("From PR"));

    const input = await screen.findByPlaceholderText(/Search PRs/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    // Select the first PR
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Fix login bug"));

    // Submit the form
    fireEvent.click(screen.getByText("Create"));

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeBranch: "fix-login",
        newBranch: false,
        prNumber: 42,
        prUrl: "https://github.com/org/repo/pull/42",
      }),
    );
  });

  it("disables Create button when no PR is selected", async () => {
    mockInvoke.mockResolvedValue(samplePrs);

    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} sessions={[]} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("+ Add Session"));
    fireEvent.click(screen.getByText("From PR"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search PRs/)).toBeInTheDocument();
    });

    expect(screen.getByText("Create")).toBeDisabled();
  });

  it("does not show From PR for non-git repos", () => {
    render(
      <Wrapper>
        <AddSessionBar {...defaultProps} isGitRepo={false} sessions={[]} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("+ Add Session"));
    expect(screen.queryByText("From PR")).not.toBeInTheDocument();
  });
});
