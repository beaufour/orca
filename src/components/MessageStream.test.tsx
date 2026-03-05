import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { MessageStream } from "./MessageStream";
import type { RemoteSession } from "../types";

const mockedInvoke = vi.mocked(invoke);

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function makeSession(overrides?: Partial<RemoteSession>): RemoteSession {
  return {
    id: "sess-1",
    title: "Test Session",
    status: "idle",
    ...overrides,
  };
}

describe("MessageStream", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue([]);
  });

  it("shows Diff button for claude-remote backend", () => {
    render(
      <MessageStream
        session={makeSession()}
        serverUrl="https://example.com"
        serverPassword="tok"
        backend="claude-remote"
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByTitle("View branch diff")).toBeInTheDocument();
  });

  it("does not show Diff button for opencode-remote backend", () => {
    render(
      <MessageStream
        session={makeSession()}
        serverUrl="https://example.com"
        serverPassword="tok"
        backend="opencode-remote"
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.queryByTitle("View branch diff")).not.toBeInTheDocument();
  });

  it("shows DiffViewer when Diff button is clicked", async () => {
    render(
      <MessageStream
        session={makeSession()}
        serverUrl="https://example.com"
        serverPassword="tok"
        backend="claude-remote"
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByTitle("View branch diff"));
    // DiffViewer renders a loading state initially
    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
  });

  it("renders session title in header", () => {
    render(
      <MessageStream
        session={makeSession({ title: "My Session" })}
        serverUrl="https://example.com"
        serverPassword="tok"
        backend="claude-remote"
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText("My Session")).toBeInTheDocument();
  });

  it("calls onClose when Close button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <MessageStream
        session={makeSession()}
        serverUrl="https://example.com"
        serverPassword="tok"
        backend="claude-remote"
        onClose={onClose}
      />,
      { wrapper },
    );
    // Select the Close button within the message-stream header specifically
    const closeBtn = container.querySelector(".terminal-close")!;
    closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
