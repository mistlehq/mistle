import { describe, expect, it } from "vitest";

import { IntegrationsApiError } from "../integrations/integrations-service.js";
import { resolveResourceListViewState } from "./webhook-trigger-actor-policy-fields.js";

describe("resolveResourceListViewState", () => {
  it("keeps actor resource load errors visible when only some errored queries need resource sync", () => {
    const state = resolveResourceListViewState({
      errorMessage: "Could not load actors.",
      errors: [
        new IntegrationsApiError({
          operation: "listIntegrationConnectionResources",
          status: 409,
          body: {
            code: "RESOURCE_SYNC_REQUIRED",
            message: "Resource sync is required before resources can be listed.",
          },
          code: "RESOURCE_SYNC_REQUIRED",
          message: "Resource sync is required before resources can be listed.",
        }),
        new Error("GitHub API request failed."),
      ],
      isError: true,
      isPending: false,
    });

    expect(state).toEqual({
      mode: "error",
      message: "Could not load actors.",
    });
  });

  it("treats resource sync prerequisite errors as a ready empty resource list state", () => {
    const state = resolveResourceListViewState({
      errorMessage: "Could not load actors.",
      errors: [
        new IntegrationsApiError({
          operation: "listIntegrationConnectionResources",
          status: 409,
          body: {
            code: "RESOURCE_SYNC_REQUIRED",
            message: "Resource sync is required before resources can be listed.",
          },
          code: "RESOURCE_SYNC_REQUIRED",
          message: "Resource sync is required before resources can be listed.",
        }),
      ],
      isError: true,
      isPending: false,
    });

    expect(state).toEqual({
      mode: "ready",
    });
  });
});
