import { describe, expect, it } from "vitest";

import {
  codexReviewStartIsBlockedByTurnStatus,
  parseCodexReviewBranchList,
  parseCodexReviewCommand,
} from "./codex-review-state.js";

describe("parseCodexReviewCommand", () => {
  it("opens the target picker for a bare review command", () => {
    expect(parseCodexReviewCommand("/review")).toEqual({
      status: "valid",
      command: { kind: "showTargetPicker" },
    });
  });

  it("treats text after review as custom instructions", () => {
    expect(parseCodexReviewCommand("/review check the auth flow")).toEqual({
      status: "valid",
      command: {
        kind: "customInstructions",
        instructions: "check the auth flow",
      },
    });
  });

  it("does not match longer slash command names", () => {
    expect(parseCodexReviewCommand("/reviewer")).toEqual({
      status: "notReviewCommand",
    });
  });
});

describe("codexReviewStartIsBlockedByTurnStatus", () => {
  it("blocks review starts while the active Codex turn is in progress", () => {
    expect(codexReviewStartIsBlockedByTurnStatus("inProgress")).toBe(true);
    expect(codexReviewStartIsBlockedByTurnStatus("completed")).toBe(false);
    expect(codexReviewStartIsBlockedByTurnStatus(null)).toBe(false);
  });
});

describe("parseCodexReviewBranchList", () => {
  it("includes local and remote branches while dropping HEAD aliases", () => {
    expect(
      parseCodexReviewBranchList(
        ["main", "origin/HEAD", "origin/main", "feature/review", "origin/main", ""].join("\n"),
      ),
    ).toEqual(["feature/review", "main", "origin/main"]);
  });
});
