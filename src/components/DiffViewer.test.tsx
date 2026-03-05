import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiffViewer } from "./DiffViewer";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const SAMPLE_DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
`;

describe("DiffViewer", () => {
  afterEach(cleanup);

  it("shows loading state", () => {
    const fetchDiff = vi.fn(() => new Promise<string>(() => {})); // never resolves
    render(
      <DiffViewer
        sessionId="s1"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
  });

  it("shows error state", async () => {
    const fetchDiff = vi.fn(() => Promise.reject(new Error("network error")));
    render(
      <DiffViewer
        sessionId="s2"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByText(/network error/)).toBeInTheDocument();
    });
  });

  it("shows diff content on success", async () => {
    const fetchDiff = vi.fn(() => Promise.resolve(SAMPLE_DIFF));
    render(
      <DiffViewer
        sessionId="s3"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    await waitFor(() => {
      // File header in the diff body (use getAllByText since it appears in sidebar + header)
      expect(screen.getAllByText("foo.ts").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("Diff: my-branch")).toBeInTheDocument();
  });

  it("shows empty state when diff is empty", async () => {
    const fetchDiff = vi.fn(() => Promise.resolve(""));
    render(
      <DiffViewer
        sessionId="s4"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByText("No changes compared to default branch")).toBeInTheDocument();
    });
  });

  it("hides send button when sendComments is null", async () => {
    const fetchDiff = vi.fn(() => Promise.resolve(SAMPLE_DIFF));
    render(
      <DiffViewer
        sessionId="s5"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getAllByText("foo.ts").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/Send .* to Claude/)).not.toBeInTheDocument();
  });

  it("calls fetchDiff on mount", async () => {
    const fetchDiff = vi.fn(() => Promise.resolve(SAMPLE_DIFF));
    render(
      <DiffViewer
        sessionId="s6"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect(fetchDiff).toHaveBeenCalled();
    });
  });

  it("calls onClose when Close button is clicked", async () => {
    const fetchDiff = vi.fn(() => Promise.resolve(""));
    const onClose = vi.fn();
    render(
      <DiffViewer
        sessionId="s7"
        branchLabel="my-branch"
        fetchDiff={fetchDiff}
        sendComments={null}
        onClose={onClose}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByText("No changes compared to default branch")).toBeInTheDocument();
    });
    screen.getByText("Close").click();
    expect(onClose).toHaveBeenCalled();
  });
});
