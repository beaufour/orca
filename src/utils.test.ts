import { describe, expect, it } from "vitest";
import {
  formatPath,
  formatTime,
  fallbackAttention,
  parseDiff,
  fileName,
  fileDir,
  isMainSession,
} from "./utils";

describe("formatPath", () => {
  it("replaces /Users/<user>/ with ~/", () => {
    expect(formatPath("/Users/alice/projects/foo")).toBe("~/projects/foo");
  });

  it("handles deeply nested paths", () => {
    expect(formatPath("/Users/bob/a/b/c")).toBe("~/a/b/c");
  });

  it("returns non-home paths unchanged", () => {
    expect(formatPath("/tmp/foo/bar")).toBe("/tmp/foo/bar");
  });

  it("returns path unchanged if only /Users/<user> with no trailing slash", () => {
    expect(formatPath("/Users/alice")).toBe("/Users/alice");
  });

  it("returns empty string unchanged", () => {
    expect(formatPath("")).toBe("");
  });
});

describe("formatTime", () => {
  it('returns "never" for zero', () => {
    expect(formatTime(0)).toBe("never");
  });

  it('returns "never" for negative', () => {
    expect(formatTime(-100)).toBe("never");
  });

  it('returns "just now" for recent timestamps', () => {
    const now = Date.now() / 1000;
    expect(formatTime(now)).toBe("just now");
    expect(formatTime(now - 30)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const now = Date.now() / 1000;
    expect(formatTime(now - 5 * 60)).toBe("5m ago");
    expect(formatTime(now - 59 * 60)).toBe("59m ago");
  });

  it("returns hours ago", () => {
    const now = Date.now() / 1000;
    expect(formatTime(now - 2 * 3600)).toBe("2h ago");
    expect(formatTime(now - 23 * 3600)).toBe("23h ago");
  });

  it("returns days ago", () => {
    const now = Date.now() / 1000;
    expect(formatTime(now - 25 * 3600)).toBe("1d ago");
    expect(formatTime(now - 72 * 3600)).toBe("3d ago");
  });
});

describe("fallbackAttention", () => {
  it('maps "running" to running', () => {
    expect(fallbackAttention("running")).toBe("running");
  });

  it('maps "waiting" to needs_input', () => {
    expect(fallbackAttention("waiting")).toBe("needs_input");
  });

  it('maps "error" to error', () => {
    expect(fallbackAttention("error")).toBe("error");
  });

  it('maps "idle" to idle', () => {
    expect(fallbackAttention("idle")).toBe("idle");
  });

  it("maps unknown strings to unknown", () => {
    expect(fallbackAttention("something_else")).toBe("unknown");
    expect(fallbackAttention("")).toBe("unknown");
  });
});

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("parses a single file with additions and deletions", () => {
    const raw = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/foo.ts");
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].lines).toHaveLength(4);
    expect(files[0].hunks[0].lines[0]).toEqual({ type: "context", content: " line1" });
    expect(files[0].hunks[0].lines[1]).toEqual({ type: "deletion", content: "-old line" });
    expect(files[0].hunks[0].lines[2]).toEqual({ type: "addition", content: "+new line" });
    expect(files[0].hunks[0].lines[3]).toEqual({ type: "context", content: " line3" });
  });

  it("parses multiple files", () => {
    const raw = `diff --git a/a.ts b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
@@ -1 +1,2 @@
 existing
+added`;
    const files = parseDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("a.ts");
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
    expect(files[1].path).toBe("b.ts");
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(0);
  });

  it("handles multiple hunks in one file", () => {
    const raw = `diff --git a/file.ts b/file.ts
@@ -1,2 +1,2 @@
-a
+b
@@ -10,2 +10,2 @@
-c
+d`;
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(2);
  });

  it("handles context-only hunks", () => {
    const raw = `diff --git a/file.ts b/file.ts
@@ -1,2 +1,2 @@
 line1
 line2`;
    const files = parseDiff(raw);
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(0);
    expect(files[0].hunks[0].lines).toHaveLength(2);
  });
});

describe("fileName", () => {
  it("extracts filename from path", () => {
    expect(fileName("src/components/App.tsx")).toBe("App.tsx");
  });

  it("returns the whole string for root-level files", () => {
    expect(fileName("README.md")).toBe("README.md");
  });

  it("handles deeply nested paths", () => {
    expect(fileName("a/b/c/d.ts")).toBe("d.ts");
  });
});

describe("fileDir", () => {
  it("extracts directory from path with trailing slash", () => {
    expect(fileDir("src/components/App.tsx")).toBe("src/components/");
  });

  it("returns empty string for root-level files", () => {
    expect(fileDir("README.md")).toBe("");
  });

  it("handles deeply nested paths", () => {
    expect(fileDir("a/b/c/d.ts")).toBe("a/b/c/");
  });
});

describe("isMainSession", () => {
  it("returns true for undefined branch", () => {
    expect(isMainSession(undefined)).toBe(true);
  });

  it("returns true for empty string branch", () => {
    expect(isMainSession("")).toBe(true);
  });

  it("returns true for main branch", () => {
    expect(isMainSession("main")).toBe(true);
  });

  it("returns true for master branch", () => {
    expect(isMainSession("master")).toBe(true);
  });

  it("returns false for feature branch", () => {
    expect(isMainSession("feature-123")).toBe(false);
  });
});
