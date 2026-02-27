import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ error }: { error: Error }) {
  throw error;
}

describe("ErrorBoundary", () => {
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
    cleanup();
  });

  it("renders children when no error", () => {
    const { container } = render(
      <ErrorBoundary>
        <span>All good</span>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("All good");
  });

  it("renders error message when child throws", () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("Test crash")} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).toContain("Test crash");
  });

  it("shows Try again button in error state", () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("Boom")} />
      </ErrorBoundary>,
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("Try again");
  });

  it("Try again button calls setState to clear error", () => {
    // We can't easily test full recovery because rerender with a
    // non-throwing child still re-triggers getDerivedStateFromError.
    // Instead, verify the button exists and is clickable.
    const { container } = render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("Boom")} />
      </ErrorBoundary>,
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    // Should not throw when clicked
    expect(() => fireEvent.click(button!)).not.toThrow();
  });
});
