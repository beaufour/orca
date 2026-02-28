import posthog from "posthog-js/dist/module.full.no-external";

const POSTHOG_KEY = "phc_uAeyQPw6NPQk05x6smnQ580bUeu6IdiREKY69j1eL4o";
const POSTHOG_HOST = "https://us.i.posthog.com";

let initialized = false;

export function initAnalytics(enabled: boolean): void {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    persistence: "localStorage",
    opt_out_capturing_by_default: true,
    capture_pageview: false,
    autocapture: false,
  });
  initialized = true;

  if (enabled) {
    posthog.opt_in_capturing();
  }
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (!initialized) return;
  if (enabled) {
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(name, properties);
}
