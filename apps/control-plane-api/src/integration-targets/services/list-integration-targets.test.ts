import type { IntegrationTarget } from "@mistle/db/control-plane";
import { describe, expect, it } from "vitest";

import { projectIntegrationTargetListItem } from "./list-integration-targets.js";

describe("projectIntegrationTargetListItem", () => {
  it("returns resource and relationship metadata needed for trigger actor set options", () => {
    const target = {
      targetKey: "slack-default",
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: "https://slack.com/api",
      },
      secrets: null,
      displayNameOverride: null,
      descriptionOverride: null,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    } satisfies IntegrationTarget;

    const projected = projectIntegrationTargetListItem(target);

    expect(projected.resourceDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user",
          attributeDefinitions: expect.arrayContaining([
            expect.objectContaining({
              key: "is_bot",
              actorPolicyEligible: true,
            }),
          ]),
        }),
      ]),
    );
    expect(projected.resourceRelationshipDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "workspace",
          scopeDefinitions: [
            expect.objectContaining({
              scopeKind: "workspace",
            }),
          ],
        }),
      ]),
    );
  });
});
