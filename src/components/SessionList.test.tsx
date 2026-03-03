import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { SessionList } from "./SessionList";
import type { Session } from "../types";
import type { PendingCreation } from "../hooks/useSessionCreation";

afterEach(cleanup);

// Mock child components to isolate SessionList logic
vi.mock("./SessionCard", () => ({
  SessionCard: ({ session, isDismissed }: { session: Session; isDismissed?: boolean }) => (
    <div data-testid={`session-${session.id}`} data-dismissed={isDismissed}>
      {session.title}
    </div>
  ),
}));

vi.mock("./MainSessionGhost", () => ({
  MainSessionGhost: () => <div data-testid="main-ghost">Ghost</div>,
}));

vi.mock("./PendingSessionCard", () => ({
  PendingSessionCard: () => <div data-testid="pending">Pending</div>,
}));

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

const noop = () => {};

describe("SessionList", () => {
  it("renders all sessions when none are dismissed", () => {
    const sessions = [
      makeSession({ id: "s1", worktree_branch: "feature-a" }),
      makeSession({ id: "s2", worktree_branch: "feature-b" }),
    ];

    render(<SessionList sessions={sessions} onSelectSession={noop} selectedSessionId={null} />);

    expect(screen.getByTestId("session-s1")).toBeInTheDocument();
    expect(screen.getByTestId("session-s2")).toBeInTheDocument();
    expect(screen.queryByText("Dismissed")).not.toBeInTheDocument();
  });

  it("separates dismissed sessions into collapsed section", () => {
    const sessions = [
      makeSession({ id: "s1", worktree_branch: "feature-a" }),
      makeSession({ id: "s2", worktree_branch: "feature-b" }),
    ];
    const dismissedIds = new Set(["s2"]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        dismissedIds={dismissedIds}
      />,
    );

    // Active session visible
    expect(screen.getByTestId("session-s1")).toBeInTheDocument();
    // Dismissed session hidden (collapsed)
    expect(screen.queryByTestId("session-s2")).not.toBeInTheDocument();
    // Dismissed section header visible with count
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("expands dismissed section on click", () => {
    const sessions = [
      makeSession({ id: "s1", worktree_branch: "feature-a" }),
      makeSession({ id: "s2", worktree_branch: "feature-b" }),
    ];
    const dismissedIds = new Set(["s2"]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        dismissedIds={dismissedIds}
      />,
    );

    // Click to expand
    fireEvent.click(screen.getByText("Dismissed"));
    expect(screen.getByTestId("session-s2")).toBeInTheDocument();
  });

  it("keeps main branch sessions in active section even if dismissed", () => {
    const sessions = [
      makeSession({ id: "main-s", worktree_branch: "main" }),
      makeSession({ id: "feature-s", worktree_branch: "feature-x" }),
    ];
    const dismissedIds = new Set(["main-s", "feature-s"]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        dismissedIds={dismissedIds}
      />,
    );

    // Main session always stays in active section
    expect(screen.getByTestId("session-main-s")).toBeInTheDocument();
    // Feature session is dismissed
    expect(screen.queryByTestId("session-feature-s")).not.toBeInTheDocument();
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
  });

  it("does not show dismissed section when no sessions are dismissed", () => {
    const sessions = [makeSession({ id: "s1", worktree_branch: "feature-a" })];

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        dismissedIds={new Set()}
      />,
    );

    expect(screen.queryByText("Dismissed")).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <SessionList
        sessions={undefined}
        onSelectSession={noop}
        selectedSessionId={null}
        isLoading={true}
      />,
    );

    expect(screen.getByText("Loading sessions...")).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const onRetry = vi.fn();
    render(
      <SessionList
        sessions={undefined}
        onSelectSession={noop}
        selectedSessionId={null}
        error={new Error("Network error")}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/Network error/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows empty state when no sessions", () => {
    render(<SessionList sessions={[]} onSelectSession={noop} selectedSessionId={null} />);

    expect(screen.getByText("No sessions found")).toBeInTheDocument();
  });

  it("shows dismissed count matching number of dismissed sessions", () => {
    const sessions = [
      makeSession({ id: "s1", worktree_branch: "feature-a" }),
      makeSession({ id: "s2", worktree_branch: "feature-b" }),
      makeSession({ id: "s3", worktree_branch: "feature-c" }),
    ];
    const dismissedIds = new Set(["s2", "s3"]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        dismissedIds={dismissedIds}
      />,
    );

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("collapses dismissed section on second click", () => {
    const sessions = [
      makeSession({ id: "s1", worktree_branch: "feature-a" }),
      makeSession({ id: "s2", worktree_branch: "feature-b" }),
    ];
    const dismissedIds = new Set(["s2"]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        dismissedIds={dismissedIds}
      />,
    );

    // Expand
    fireEvent.click(screen.getByText("Dismissed"));
    expect(screen.getByTestId("session-s2")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText("Dismissed"));
    expect(screen.queryByTestId("session-s2")).not.toBeInTheDocument();
  });

  it("shows MainSessionGhost when group has no main session", () => {
    const sessions = [makeSession({ id: "s1", worktree_branch: "feature-a" })];

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        groupPath="/group"
        repoPath="/repo"
      />,
    );

    expect(screen.getByTestId("main-ghost")).toBeInTheDocument();
  });

  it("does not show MainSessionGhost when main session exists", () => {
    const sessions = [
      makeSession({ id: "s1", worktree_branch: "main" }),
      makeSession({ id: "s2", worktree_branch: "feature-a" }),
    ];

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        groupPath="/group"
        repoPath="/repo"
      />,
    );

    expect(screen.queryByTestId("main-ghost")).not.toBeInTheDocument();
  });

  it("renders pending session cards", () => {
    const sessions = [makeSession({ id: "s1", worktree_branch: "feature-a" })];
    const pending = new Map<string, PendingCreation>([
      [
        "p1",
        {
          creationId: "p1",
          title: "New session",
          groupPath: "/group",
          startedAt: Date.now(),
        },
      ],
    ]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        groupPath="/group"
        pendingCreations={pending}
      />,
    );

    expect(screen.getByTestId("pending")).toBeInTheDocument();
  });

  it("filters pending creations to current group", () => {
    const sessions = [makeSession({ id: "s1", worktree_branch: "feature-a" })];
    const pending = new Map<string, PendingCreation>([
      [
        "p1",
        {
          creationId: "p1",
          title: "Other group",
          groupPath: "/other-group",
          startedAt: Date.now(),
        },
      ],
    ]);

    render(
      <SessionList
        sessions={sessions}
        onSelectSession={noop}
        selectedSessionId={null}
        groupPath="/group"
        pendingCreations={pending}
      />,
    );

    expect(screen.queryByTestId("pending")).not.toBeInTheDocument();
  });

  it("shows error without retry button when onRetry not provided", () => {
    render(
      <SessionList
        sessions={undefined}
        onSelectSession={noop}
        selectedSessionId={null}
        error={new Error("Oops")}
      />,
    );

    expect(screen.getByText(/Oops/)).toBeInTheDocument();
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });
});
