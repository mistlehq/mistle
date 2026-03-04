import { describe, expect, it } from "vitest";

import { resolveProfileNameCommitDecision } from "./sandbox-profile-title-edit.js";

describe("resolveProfileNameCommitDecision", () => {
  it("returns save when display name changed", () => {
    expect(
      resolveProfileNameCommitDecision({
        draftDisplayName: "Updated Profile",
        persistedDisplayName: "Old Profile",
      }),
    ).toEqual({
      action: "save",
      displayName: "Updated Profile",
    });
  });

  it("returns noop when display name is unchanged after trim", () => {
    expect(
      resolveProfileNameCommitDecision({
        draftDisplayName: "  Existing Profile  ",
        persistedDisplayName: "Existing Profile",
      }),
    ).toEqual({
      action: "noop",
      displayName: "Existing Profile",
    });
  });

  it("returns revert when display name is blank", () => {
    expect(
      resolveProfileNameCommitDecision({
        draftDisplayName: "   ",
        persistedDisplayName: "Existing Profile",
      }),
    ).toEqual({
      action: "revert",
    });
  });
});
