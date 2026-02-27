import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders children", () => {
    render(
      <Modal onClose={vi.fn()}>
        <span>Hello</span>
      </Modal>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal onClose={onClose}>
        <span>Content</span>
      </Modal>,
    );
    // Click on the backdrop (outermost div)
    fireEvent.click(container.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when content area is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal onClose={onClose}>
        <span>Content</span>
      </Modal>,
    );
    fireEvent.click(container.querySelector(".modal-content")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses default className", () => {
    const { container } = render(
      <Modal onClose={vi.fn()}>
        <span>Content</span>
      </Modal>,
    );
    expect(container.querySelector(".modal-content")).toBeInTheDocument();
  });

  it("uses custom className", () => {
    const { container } = render(
      <Modal onClose={vi.fn()} className="custom-class">
        <span>Content</span>
      </Modal>,
    );
    expect(container.querySelector(".custom-class")).toBeInTheDocument();
    expect(container.querySelector(".modal-content")).not.toBeInTheDocument();
  });
});
