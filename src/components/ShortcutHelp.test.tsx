import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortcutHelp } from "./ShortcutHelp";

describe("ShortcutHelp", () => {
  it("renders the title", () => {
    render(<ShortcutHelp onClose={vi.fn()} />);
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("renders shortcut keys and descriptions", () => {
    const { container } = render(<ShortcutHelp onClose={vi.fn()} />);
    const rows = container.querySelectorAll(".shortcut-row");
    expect(rows.length).toBe(18);
  });

  it("renders specific shortcut keys", () => {
    const { container } = render(<ShortcutHelp onClose={vi.fn()} />);
    const keys = Array.from(container.querySelectorAll(".shortcut-key")).map(
      (el) => el.textContent,
    );
    expect(keys).toContain("Enter");
    expect(keys).toContain("Esc");
    expect(keys).toContain("/");
    expect(keys).toContain("Ctrl+Q");
    expect(keys).toContain("?");
  });

  it("renders the close hint", () => {
    const { container } = render(<ShortcutHelp onClose={vi.fn()} />);
    expect(container.querySelector(".shortcut-hint")?.textContent).toBe("Press Esc or ? to close");
  });
});
