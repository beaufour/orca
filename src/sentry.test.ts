import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockSentryInit, mockCaptureException } = vi.hoisted(() => ({
  mockSentryInit: vi.fn(),
  mockCaptureException: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  init: mockSentryInit,
  captureException: mockCaptureException,
}));

import { initSentry, setSentryEnabled, captureException } from "./sentry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initSentry", () => {
  it("initializes Sentry with DSN and beforeSend", () => {
    initSentry();
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: expect.any(String),
        environment: expect.any(String),
        beforeSend: expect.any(Function),
      }),
    );
  });

  it("beforeSend drops events when disabled", () => {
    initSentry();
    const config = mockSentryInit.mock.calls[0][0];
    const event = { message: "test" };
    expect(config.beforeSend(event)).toBeNull();
  });

  it("beforeSend passes events when enabled", () => {
    initSentry();
    const config = mockSentryInit.mock.calls[0][0];
    setSentryEnabled(true);
    const event = { message: "test" };
    expect(config.beforeSend(event)).toBe(event);
  });
});

describe("setSentryEnabled", () => {
  it("toggles enabled state", () => {
    initSentry();
    const config = mockSentryInit.mock.calls[0][0];
    const event = { message: "test" };

    setSentryEnabled(true);
    expect(config.beforeSend(event)).toBe(event);

    setSentryEnabled(false);
    expect(config.beforeSend(event)).toBeNull();
  });
});

describe("captureException", () => {
  it("delegates to Sentry.captureException", () => {
    const error = new Error("test");
    captureException(error);
    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });
});
