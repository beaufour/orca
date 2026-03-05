import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockInit, mockOptIn, mockOptOut, mockCapture } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockOptIn: vi.fn(),
  mockOptOut: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock("posthog-js/dist/module.full.no-external", () => ({
  default: {
    init: mockInit,
    opt_in_capturing: mockOptIn,
    opt_out_capturing: mockOptOut,
    capture: mockCapture,
  },
}));

import { initAnalytics, setAnalyticsEnabled, trackEvent } from "./analytics";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initAnalytics", () => {
  it("initializes posthog and opts in when enabled", () => {
    initAnalytics(true);
    expect(mockInit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        opt_out_capturing_by_default: true,
        capture_pageview: false,
        autocapture: false,
      }),
    );
    expect(mockOptIn).toHaveBeenCalled();
  });

  it("initializes posthog without opting in when disabled", () => {
    initAnalytics(false);
    expect(mockInit).toHaveBeenCalled();
    expect(mockOptIn).not.toHaveBeenCalled();
  });
});

describe("setAnalyticsEnabled", () => {
  it("opts in when enabled", () => {
    initAnalytics(false);
    vi.clearAllMocks();
    setAnalyticsEnabled(true);
    expect(mockOptIn).toHaveBeenCalled();
  });

  it("opts out when disabled", () => {
    initAnalytics(false);
    vi.clearAllMocks();
    setAnalyticsEnabled(false);
    expect(mockOptOut).toHaveBeenCalled();
  });
});

describe("trackEvent", () => {
  it("captures event after initialization", () => {
    initAnalytics(false);
    vi.clearAllMocks();
    trackEvent("test_event", { key: "value" });
    expect(mockCapture).toHaveBeenCalledWith("test_event", { key: "value" });
  });
});
