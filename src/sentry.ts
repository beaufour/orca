import * as Sentry from "@sentry/react";

const SENTRY_DSN =
  "https://784e5e4951e78d437d264568ae36dd53@o1366758.ingest.us.sentry.io/4510964361658368";

let enabled = false;

export function initSentry(): void {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.DEV ? "development" : "production",
    beforeSend(event) {
      return enabled ? event : null;
    },
  });
}

export function setSentryEnabled(value: boolean): void {
  enabled = value;
}

export function captureException(error: unknown): void {
  Sentry.captureException(error);
}
