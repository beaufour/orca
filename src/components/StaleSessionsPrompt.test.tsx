import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StaleSessionsPrompt } from "./StaleSessionsPrompt";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

afterEach(() => {
  cleanup();
  mockInvoke.mockReset();
  localStorage.clear();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("StaleSessionsPrompt", () => {
  it("lists stale sessions with their running versions and the target version", () => {
    render(
      <Wrapper>
        <StaleSessionsPrompt
          currentVersion="2.1.114"
          stale={[
            { id: "a", title: "main", group_name: "orca", running_version: "2.1.69" },
            { id: "b", title: "feature", group_name: "services", running_version: "2.1.100" },
          ]}
          onClose={() => {}}
        />
      </Wrapper>,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
    // Group prefix is split across text nodes ("orca" and " / "); match by content
    expect(
      screen.getByText(
        (_, el) => el?.className === "stale-sessions-item-group" && el.textContent === "orca / ",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.className === "stale-sessions-item-group" && el.textContent === "services / ",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("v2.1.69")).toBeInTheDocument();
    expect(screen.getByText("v2.1.100")).toBeInTheDocument();
    // Target version appears in the body text (inside a <strong>)
    expect(
      screen.getByText((_, el) => el?.tagName === "STRONG" && el.textContent === "v2.1.114"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart 2" })).toBeInTheDocument();
  });

  it("invokes restart_session for each stale session and closes", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <Wrapper>
        <StaleSessionsPrompt
          currentVersion="2.1.114"
          stale={[
            { id: "a", title: "main", group_name: "orca", running_version: "2.1.69" },
            { id: "b", title: "feature", group_name: "services", running_version: "2.1.100" },
          ]}
          onClose={onClose}
        />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart 2" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("restart_session", {
        sessionId: "a",
        resume: true,
      });
      expect(mockInvoke).toHaveBeenCalledWith("restart_session", {
        sessionId: "b",
        resume: true,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("persists a dismissal keyed by current version + session ids", () => {
    const onClose = vi.fn();
    render(
      <Wrapper>
        <StaleSessionsPrompt
          currentVersion="2.1.114"
          stale={[{ id: "a", title: "main", group_name: "orca", running_version: "2.1.69" }]}
          onClose={onClose}
        />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));

    expect(localStorage.getItem("orca-stale-sessions-dismissed")).toBe("2.1.114:a:2.1.69");
    expect(onClose).toHaveBeenCalled();
  });
});
