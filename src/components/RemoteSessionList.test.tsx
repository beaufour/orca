import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RemoteSessionList } from "./RemoteSessionList";
import type { RemoteSession } from "../types";

const mockSessions: RemoteSession[] = [
  {
    id: "cr-1",
    title: "Test Session",
    status: "stable",
    summary: null,
    created_at: 1710000000000,
    last_accessed: 1710000000000,
    server_url: "https://example.com/claude/test",
  },
  {
    id: "cr-2",
    title: "Another Session",
    status: "stable",
    summary: null,
    created_at: 1710001000000,
    last_accessed: 1710001000000,
    server_url: "https://example.com/claude/another",
  },
];

describe("RemoteSessionList", () => {
  afterEach(() => cleanup());
  it("renders nothing when sessions is empty", () => {
    const { container } = render(
      <RemoteSessionList sessions={[]} onSelect={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders session cards", () => {
    render(<RemoteSessionList sessions={mockSessions} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Test Session")).toBeDefined();
    expect(screen.getByText("Another Session")).toBeDefined();
  });

  it("calls onSelect when clicking a card", () => {
    const onSelect = vi.fn();
    render(<RemoteSessionList sessions={mockSessions} onSelect={onSelect} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTestId("remote-session-cr-1"));
    expect(onSelect).toHaveBeenCalledWith(mockSessions[0]);
  });

  it("renders remove buttons for each session", () => {
    render(<RemoteSessionList sessions={mockSessions} onSelect={vi.fn()} onDelete={vi.fn()} />);
    const removeButtons = screen.getAllByTitle("Remove session");
    expect(removeButtons).toHaveLength(2);
  });
});
