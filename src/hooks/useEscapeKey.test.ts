import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEscapeKey } from "./useEscapeKey";

describe("useEscapeKey", () => {
  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeKey(onClose));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for other keys", () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeKey(onClose));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onClose));

    unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
