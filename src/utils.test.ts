import { describe, expect, it, vi } from "vitest";
import {
  ATTENTION_CONFIG,
  formatPath,
  formatTime,
  fallbackAttention,
  extractIssueNumber,
  issueToSlug,
  formatCommentsAsPrompt,
  parseDiff,
  fileName,
  fileDir,
  isMainSession,
  validateBranchName,
  storageGet,
  storageSet,
} from "./utils";
import type { DiffComment } from "./utils";

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

describe("ATTENTION_CONFIG", () => {
  it("has entries for all expected statuses", () => {
    const keys = Object.keys(ATTENTION_CONFIG);
    expect(keys).toContain("needs_input");
    expect(keys).toContain("error");
    expect(keys).toContain("running");
    expect(keys).toContain("idle");
    expect(keys).toContain("stale");
    expect(keys).toContain("unknown");
    expect(keys).toHaveLength(6);
  });

  it("each entry has a label and className", () => {
    for (const [, value] of Object.entries(ATTENTION_CONFIG)) {
      expect(value).toHaveProperty("label");
      expect(value).toHaveProperty("className");
      expect(typeof value.label).toBe("string");
      expect(typeof value.className).toBe("string");
    }
  });
});

describe("extractIssueNumber", () => {
  it("extracts number from branch like 42-fix-bug", () => {
    expect(extractIssueNumber("42-fix-bug")).toBe(42);
  });

  it("extracts number from branch with just number prefix", () => {
    expect(extractIssueNumber("123-")).toBe(123);
  });

  it("returns null for branch without number prefix", () => {
    expect(extractIssueNumber("feature-branch")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractIssueNumber("")).toBeNull();
  });

  it("returns null for number without dash", () => {
    expect(extractIssueNumber("42")).toBeNull();
  });

  it("extracts only the leading number", () => {
    expect(extractIssueNumber("7-add-99-things")).toBe(7);
  });
});

describe("issueToSlug", () => {
  it("generates branch name from issue number and title", () => {
    expect(issueToSlug(42, "Fix the login bug")).toBe("42-fix-the-login-bug");
  });

  it("replaces special characters with dashes", () => {
    expect(issueToSlug(1, "Hello, World! (test)")).toBe("1-hello-world-test");
  });

  it("trims leading and trailing dashes from slug", () => {
    expect(issueToSlug(5, "  --hello--  ")).toBe("5-hello");
  });

  it("truncates long titles to 50 chars", () => {
    const longTitle = "a".repeat(100);
    const result = issueToSlug(1, longTitle);
    // "1-" + 50 chars of "a"
    expect(result).toBe("1-" + "a".repeat(50));
  });

  it("handles empty title", () => {
    expect(issueToSlug(1, "")).toBe("1-");
  });
});

describe("formatCommentsAsPrompt", () => {
  it("formats a single comment", () => {
    const comments: DiffComment[] = [
      {
        id: 1,
        filePath: "src/foo.ts",
        hunkIndex: 0,
        startLine: 1,
        endLine: 2,
        text: "Please fix this",
        lines: [
          { type: "addition", content: "+new line" },
          { type: "deletion", content: "-old line" },
        ],
      },
    ];
    const result = formatCommentsAsPrompt(comments);
    expect(result).toContain("review comments");
    expect(result).toContain("## Comment 1: src/foo.ts");
    expect(result).toContain("+new line");
    expect(result).toContain("-old line");
    expect(result).toContain("Please fix this");
  });

  it("formats multiple comments", () => {
    const comments: DiffComment[] = [
      {
        id: 1,
        filePath: "a.ts",
        hunkIndex: 0,
        startLine: 1,
        endLine: 1,
        text: "Comment A",
        lines: [{ type: "context", content: " line" }],
      },
      {
        id: 2,
        filePath: "b.ts",
        hunkIndex: 0,
        startLine: 1,
        endLine: 1,
        text: "Comment B",
        lines: [{ type: "addition", content: "+added" }],
      },
    ];
    const result = formatCommentsAsPrompt(comments);
    expect(result).toContain("## Comment 1: a.ts");
    expect(result).toContain("## Comment 2: b.ts");
    expect(result).toContain("Comment A");
    expect(result).toContain("Comment B");
  });
});

describe("storageGet", () => {
  it("returns value from localStorage", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => "test-value" },
      writable: true,
      configurable: true,
    });
    expect(storageGet("test-key")).toBe("test-value");
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("returns null for missing key", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => null },
      writable: true,
      configurable: true,
    });
    expect(storageGet("nonexistent")).toBeNull();
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("returns null when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("quota exceeded");
        },
      },
      writable: true,
      configurable: true,
    });
    expect(storageGet("key")).toBeNull();
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      writable: true,
      configurable: true,
    });
  });
});

describe("storageSet", () => {
  it("stores value in localStorage", () => {
    const mockSetItem = vi.fn();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { setItem: mockSetItem },
      writable: true,
      configurable: true,
    });
    storageSet("key", "value");
    expect(mockSetItem).toHaveBeenCalledWith("key", "value");
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("silently ignores errors", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
      writable: true,
      configurable: true,
    });
    expect(() => storageSet("key", "value")).not.toThrow();
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      writable: true,
      configurable: true,
    });
  });
});

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(validateBranchName("feature-123")).toBeNull();
    expect(validateBranchName("fix/auth-bug")).toBeNull();
    expect(validateBranchName("v1.2.3")).toBeNull();
    expect(validateBranchName("my-branch")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateBranchName("")).toBe("Branch name is required");
  });

  it("rejects names starting with dash", () => {
    expect(validateBranchName("-branch")).toBe("Cannot start with '-'");
  });

  it("rejects names starting with dot", () => {
    expect(validateBranchName(".hidden")).toBe("Cannot start with '.'");
  });

  it("rejects names ending with dot", () => {
    expect(validateBranchName("branch.")).toBe("Cannot end with '.'");
  });

  it("rejects names ending with .lock", () => {
    expect(validateBranchName("branch.lock")).toBe("Cannot end with '.lock'");
  });

  it("rejects double dots", () => {
    expect(validateBranchName("a..b")).toBe("Cannot contain '..'");
  });

  it("rejects @{ sequence", () => {
    expect(validateBranchName("a@{b")).toBe("Cannot contain '@{'");
  });

  it("rejects spaces and special characters", () => {
    expect(validateBranchName("my branch")).toBe("Contains invalid characters");
    expect(validateBranchName("a~b")).toBe("Contains invalid characters");
    expect(validateBranchName("a^b")).toBe("Contains invalid characters");
    expect(validateBranchName("a:b")).toBe("Contains invalid characters");
    expect(validateBranchName("a?b")).toBe("Contains invalid characters");
    expect(validateBranchName("a*b")).toBe("Contains invalid characters");
    expect(validateBranchName("a[b")).toBe("Contains invalid characters");
    expect(validateBranchName("a\\b")).toBe("Contains invalid characters");
  });
});
