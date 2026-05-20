import { describe, expect, it } from "vitest";

import {
  decrementPendingLinkedAccountConfigCount,
  incrementPendingLinkedAccountConfigCount,
  resolvePendingLinkedAccountConfigIds,
} from "./pending-linked-account-provider-families.js";

describe("profile-settings pending linked-account configs", () => {
  it("keeps multiple configs pending when overlapping actions are in flight", () => {
    const afterGitHubStart = incrementPendingLinkedAccountConfigCount({}, "ilp_github");
    const afterSlackStart = incrementPendingLinkedAccountConfigCount(afterGitHubStart, "ilp_slack");

    expect(resolvePendingLinkedAccountConfigIds(afterSlackStart).sort()).toEqual([
      "ilp_github",
      "ilp_slack",
    ]);
  });

  it("keeps one config pending until all overlapping actions for that config settle", () => {
    const afterFirstStart = incrementPendingLinkedAccountConfigCount({}, "ilp_github");
    const afterSecondStart = incrementPendingLinkedAccountConfigCount(
      afterFirstStart,
      "ilp_github",
    );
    const afterFirstFinish = decrementPendingLinkedAccountConfigCount(
      afterSecondStart,
      "ilp_github",
    );

    expect(resolvePendingLinkedAccountConfigIds(afterFirstFinish)).toEqual(["ilp_github"]);

    const afterSecondFinish = decrementPendingLinkedAccountConfigCount(
      afterFirstFinish,
      "ilp_github",
    );

    expect(resolvePendingLinkedAccountConfigIds(afterSecondFinish)).toEqual([]);
  });
});
