import { describe, expect, it } from "vitest";

import { listSupportedCapabilities, MistleSupportedCapabilityKinds } from "./capability-catalog.js";
import { createIntegrationRegistry } from "./server.js";

describe("Mistle capability catalog", () => {
  it("lists compact supportability metadata without requiring organization state", () => {
    const catalog = listSupportedCapabilities(createIntegrationRegistry(), {
      providerFamilyId: "github",
    });

    expect(catalog.items).toHaveLength(2);
    expect(catalog.items.map((item) => item.variantId)).toEqual([
      "github-cloud",
      "github-enterprise-server",
    ]);
    expect(catalog.items[0]).toMatchObject({
      familyId: "github",
      displayName: "GitHub",
      capabilities: {
        triggerEvents: {
          eventCount: expect.any(Number),
        },
        providerResources: {
          resourceKindCount: 5,
        },
      },
    });
    expect(catalog.items[0]?.capabilities.triggerEvents.eventCount).toBeGreaterThan(0);
    expect(catalog.items[0]?.capabilities.triggerEvents.events).toBeUndefined();
  });

  it("reports runtime MCP support separately from trigger support", () => {
    const catalog = listSupportedCapabilities(createIntegrationRegistry(), {
      providerFamilyId: "slack",
    });

    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toMatchObject({
      familyId: "slack",
      capabilities: {
        runtimeTools: {
          mcpSupported: true,
        },
      },
    });
  });

  it("includes trigger event and provider resource details when requested", () => {
    const catalog = listSupportedCapabilities(createIntegrationRegistry(), {
      providerFamilyId: "github",
      includeDetails: true,
    });

    const githubCloud = catalog.items.find((item) => item.variantId === "github-cloud");
    expect(githubCloud?.capabilities.triggerEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.pull_request.review_requested",
          displayName: "Pull request review requested",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              kind: "resource-select",
              resourceKind: "team",
            }),
          ]),
        }),
      ]),
    );
    expect(githubCloud?.capabilities.providerResources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
          selectionMode: "multi",
        }),
      ]),
    );
  });

  it("filters to providers that support the requested capability kind", () => {
    const catalog = listSupportedCapabilities(createIntegrationRegistry(), {
      capabilityKind: MistleSupportedCapabilityKinds.TRIGGER_EVENT,
    });

    expect(catalog.items.length).toBeGreaterThan(0);
    expect(catalog.items.every((item) => item.capabilities.triggerEvents.eventCount > 0)).toBe(
      true,
    );
    expect(catalog.items.map((item) => item.familyId)).toContain("slack");
  });
});
