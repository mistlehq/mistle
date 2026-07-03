import {
  IntegrationResourceSyncFailure,
  IntegrationResourceSyncFailureCodes,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveResourceSyncFailure } from "./resolve-resource-sync-failure.js";

describe("resolveResourceSyncFailure", () => {
  it("preserves typed integration resource sync failures", () => {
    const failure = resolveResourceSyncFailure(
      new IntegrationResourceSyncFailure({
        code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
        message: "GitHub denied access while syncing resources.",
      }),
    );

    expect(failure).toEqual({
      code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
      message: "GitHub denied access while syncing resources.",
    });
  });

  it("keeps ordinary provider errors as generic resource sync failures", () => {
    const failure = resolveResourceSyncFailure(new Error("Provider timed out."));

    expect(failure).toEqual({
      code: "resource_sync_failed",
      message: "Provider timed out.",
    });
  });
});
