import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import { SyncIntegrationTargetsForTests } from "./sync-integration-targets.js";

describe("sync-integration-targets", () => {
  it("builds target sync entries from the registry with disabled defaults", () => {
    const integrationRegistry = createIntegrationRegistry();
    const targets = SyncIntegrationTargetsForTests.buildSyncIntegrationTargets(integrationRegistry);

    expect(targets).toEqual([
      {
        targetKey: "atlassian-default",
        familyId: "atlassian",
        variantId: "atlassian-default",
        enabled: false,
        config: {},
      },
      {
        targetKey: "github-cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: false,
        config: {},
      },
      {
        targetKey: "github-enterprise-server",
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: false,
        config: {},
      },
      {
        targetKey: "linear-default",
        familyId: "linear",
        variantId: "linear-default",
        enabled: false,
        config: {},
      },
      {
        targetKey: "notion-default",
        familyId: "notion",
        variantId: "notion-default",
        enabled: false,
        config: {},
      },
      {
        targetKey: "openai-default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: false,
        config: {},
      },
    ]);
  });
});
