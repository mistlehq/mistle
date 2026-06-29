import { describe, expect, it } from "vitest";

import { DESIGNER_RUNTIME_PROFILE_ID } from "../../designer/constants.js";
import { resolveUsageProfileLabel } from "./organization-usage.js";

describe("resolveUsageProfileLabel", () => {
  it("labels Designer runtime usage instead of treating the synthetic profile as deleted", () => {
    expect(
      resolveUsageProfileLabel({
        profileNames: new Map(),
        sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
      }),
    ).toBe("Mistle Designer");
  });

  it("keeps the deleted profile label for missing user sandbox profiles", () => {
    expect(
      resolveUsageProfileLabel({
        profileNames: new Map(),
        sandboxProfileId: "sbp_deleted",
      }),
    ).toBe("Deleted sandbox profile");
  });
});
