import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";

describe("queryKeys", () => {
  it("sessions without groupPath returns base key", () => {
    expect(queryKeys.sessions()).toEqual(["sessions"]);
  });

  it("sessions with groupPath includes it", () => {
    expect(queryKeys.sessions("/path/to/group")).toEqual(["sessions", "/path/to/group"]);
  });

  it("sessions with null returns base key", () => {
    expect(queryKeys.sessions(null)).toEqual(["sessions"]);
  });

  it("attentionSessions is correct", () => {
    expect(queryKeys.attentionSessions).toEqual(["sessions", "__needs_action__"]);
  });

  it("groups is correct", () => {
    expect(queryKeys.groups).toEqual(["groups"]);
  });

  it("worktrees includes repo path", () => {
    expect(queryKeys.worktrees("/repo")).toEqual(["worktrees", "/repo"]);
  });

  it("branchDiff includes session id", () => {
    expect(queryKeys.branchDiff("sess-1")).toEqual(["branch-diff", "sess-1"]);
  });

  it("summary includes session id", () => {
    expect(queryKeys.summary("sess-1")).toEqual(["summary", "sess-1"]);
  });

  it("issues includes repo path", () => {
    expect(queryKeys.issues("/repo")).toEqual(["issues", "/repo"]);
  });
});
