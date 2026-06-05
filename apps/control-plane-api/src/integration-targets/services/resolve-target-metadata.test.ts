import { describe, expect, it } from "vitest";

import { resolveTargetMetadata } from "./resolve-target-metadata.js";

describe("resolveTargetMetadata", () => {
  it("preserves webhook event parameter grouping metadata from integration definitions", () => {
    const metadata = resolveTargetMetadata({
      familyId: "github",
      variantId: "github-cloud",
      displayNameOverride: null,
      descriptionOverride: null,
    });

    expect(metadata.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.pull_request.review_requested",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "requestedReviewer",
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedTeam",
              negatedMatchRequiresExists: true,
            }),
          ]),
          parameterGroups: [
            {
              id: "requestedReviewTarget",
              label: "requested review target",
              kind: "oneOf",
              options: [
                {
                  parameterId: "requestedReviewer",
                  label: "for reviewer",
                },
                {
                  parameterId: "requestedTeam",
                  label: "for team",
                },
              ],
            },
          ],
        }),
      ]),
    );
  });

  it("requires override-only targets to resolve to a registered integration definition", () => {
    expect(() =>
      resolveTargetMetadata({
        familyId: "renamed-openai",
        variantId: "custom-openai",
        displayNameOverride: "Custom OpenAI",
        descriptionOverride: "Custom OpenAI target",
      }),
    ).toThrow("Integration definition 'renamed-openai::custom-openai' was not found.");
  });
});
