import { describe, expect, it } from "vitest";

import {
  decrementPendingLinkedAccountProviderFamilyCount,
  incrementPendingLinkedAccountProviderFamilyCount,
  resolvePendingLinkedAccountProviderFamilies,
} from "./pending-linked-account-provider-families.js";

describe("profile-settings pending linked-account providers", () => {
  it("keeps multiple providers pending when overlapping actions are in flight", () => {
    const afterGitHubStart = incrementPendingLinkedAccountProviderFamilyCount({}, "github");
    const afterSlackStart = incrementPendingLinkedAccountProviderFamilyCount(
      afterGitHubStart,
      "slack",
    );

    expect(resolvePendingLinkedAccountProviderFamilies(afterSlackStart).sort()).toEqual([
      "github",
      "slack",
    ]);
  });

  it("keeps one provider pending until all overlapping actions for that provider settle", () => {
    const afterFirstStart = incrementPendingLinkedAccountProviderFamilyCount({}, "github");
    const afterSecondStart = incrementPendingLinkedAccountProviderFamilyCount(
      afterFirstStart,
      "github",
    );
    const afterFirstFinish = decrementPendingLinkedAccountProviderFamilyCount(
      afterSecondStart,
      "github",
    );

    expect(resolvePendingLinkedAccountProviderFamilies(afterFirstFinish)).toEqual(["github"]);

    const afterSecondFinish = decrementPendingLinkedAccountProviderFamilyCount(
      afterFirstFinish,
      "github",
    );

    expect(resolvePendingLinkedAccountProviderFamilies(afterSecondFinish)).toEqual([]);
  });
});
