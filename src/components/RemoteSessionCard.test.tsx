import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { RemoteSessionCard } from "./RemoteSessionCard";
import type { RemoteSession } from "../types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

afterEach(cleanup);

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ status: "stable" }),
}));

function makeRemoteSession(overrides?: Partial<RemoteSession>): RemoteSession {
  return {
    id: "rs-1",
    title: "Test Remote",
    status: "stable",
    summary: null,
    created_at: Date.now(),
    last_accessed: Date.now(),
    ...overrides,
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const noop = () => {};

describe("RemoteSessionCard", () => {
  it("renders session title and remote badge", () => {
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession({ title: "My Remote Session" })}
        serverUrl="http://localhost:3000"
        token="tok"
        onClick={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("My Remote Session")).toBeInTheDocument();
    expect(screen.getByText("remote")).toBeInTheDocument();
  });

  it("falls back to id when title is empty", () => {
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession({ id: "fallback-id", title: "" })}
        serverUrl="http://localhost:3000"
        token="tok"
        onClick={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("fallback-id")).toBeInTheDocument();
  });

  it("shows initial prompt when provided", () => {
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession()}
        serverUrl="http://localhost:3000"
        token="tok"
        initialPrompt="Fix the login bug"
        onClick={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("Fix the login bug")).toBeInTheDocument();
  });

  it("does not show prompt section when initialPrompt is null", () => {
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession()}
        serverUrl="http://localhost:3000"
        token="tok"
        initialPrompt={null}
        onClick={noop}
        onRemove={noop}
      />,
    );

    expect(screen.queryByText("Fix the login bug")).not.toBeInTheDocument();
  });

  it("calls onClick when card is clicked", () => {
    const onClick = vi.fn();
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession()}
        serverUrl="http://localhost:3000"
        token="tok"
        onClick={onClick}
        onRemove={noop}
      />,
    );

    fireEvent.click(screen.getByText("Test Remote"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows confirm/cancel on Remove click, then calls onRemove on Confirm", () => {
    const onRemove = vi.fn();
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession()}
        serverUrl="http://localhost:3000"
        token="tok"
        onClick={noop}
        onRemove={onRemove}
      />,
    );

    // Initial state: Remove button visible
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();

    // Click Remove -> shows Confirm/Cancel
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();

    // Click Confirm -> calls onRemove
    fireEvent.click(screen.getByText("Confirm"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("cancels removal when Cancel is clicked", () => {
    const onRemove = vi.fn();
    renderWithQuery(
      <RemoteSessionCard
        session={makeRemoteSession()}
        serverUrl="http://localhost:3000"
        token="tok"
        onClick={noop}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getByText("Confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
