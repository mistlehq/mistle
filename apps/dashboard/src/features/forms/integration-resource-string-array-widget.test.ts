import { describe, expect, it } from "vitest";

import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { resolveIntegrationResourceListState } from "./integration-resource-string-array-widget.js";

function createResources(handles: readonly string[]): IntegrationConnectionResources {
  return {
    connectionId: "icn_123",
    familyId: "github",
    kind: "repository",
    syncState: "ready",
    items: handles.map((handle, index) => ({
      id: `icr_${String(index + 1)}`,
      familyId: "github",
      kind: "repository",
      externalId: String(index + 1),
      handle,
      displayName: handle,
      status: "accessible",
      metadata: {},
    })),
  };
}

describe("resolveIntegrationResourceListState", () => {
  it("returns a loading state during the initial fetch when no results are available yet", () => {
    expect(
      resolveIntegrationResourceListState({
        data: undefined,
        errorMessage: null,
        isError: false,
        isPending: true,
        resourceOverridePresent: false,
        visibleItems: [],
      }),
    ).toEqual({
      mode: "loading",
    });
  });

  it("keeps the previous results visible while a search refetch is pending", () => {
    const previousResults = createResources(["mistle", "mistle-docs"]);

    expect(
      resolveIntegrationResourceListState({
        data: previousResults,
        errorMessage: null,
        isError: false,
        isPending: true,
        resourceOverridePresent: false,
        visibleItems: previousResults.items,
      }),
    ).toEqual({
      mode: "ready",
      items: previousResults.items,
    });
  });

  it("uses the override items when the widget is running against local resource data", () => {
    const overrideResults = createResources(["octocat/hello-world"]);

    expect(
      resolveIntegrationResourceListState({
        data: undefined,
        errorMessage: null,
        isError: false,
        isPending: true,
        resourceOverridePresent: true,
        visibleItems: overrideResults.items,
      }),
    ).toEqual({
      mode: "ready",
      items: overrideResults.items,
    });
  });
});
