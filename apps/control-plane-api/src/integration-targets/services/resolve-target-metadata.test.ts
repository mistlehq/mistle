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
              id: "botActor",
              resourceKind: "bot",
              payloadPath: ["sender", "login"],
              multiValue: true,
            }),
            expect.objectContaining({
              id: "requestedReviewer",
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedTeam",
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedBot",
              resourceKind: "bot",
              payloadPath: ["requested_reviewer", "login"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
          ]),
          parameterGroups: [
            {
              id: "actor",
              label: "actor",
              kind: "oneOf",
              options: [
                {
                  parameterId: "author",
                  label: "by user",
                },
                {
                  parameterId: "botActor",
                  label: "by bot",
                },
              ],
            },
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
                {
                  parameterId: "requestedBot",
                  label: "for bot",
                },
              ],
            },
          ],
        }),
      ]),
    );
  });

  it("preserves associated resource event filter metadata from integration definitions", () => {
    const metadata = resolveTargetMetadata({
      familyId: "github",
      variantId: "github-cloud",
      displayNameOverride: null,
      descriptionOverride: null,
    });

    expect(metadata.supportedAssociatedResourceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKind: "github.pull_request",
          eventType: "github.pull_request.issue_comment.created",
          displayName: "PR comments",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "repository",
              payloadPath: ["repository", "full_name"],
              multiValue: true,
            }),
            expect.objectContaining({
              id: "commenter",
              payloadPath: ["sender", "login"],
              multiValue: true,
            }),
            expect.objectContaining({
              id: "invocationToken",
              payloadPath: ["comment", "body"],
              matchMode: "contains_token",
            }),
          ]),
        }),
      ]),
    );

    const issueCommentEvent = metadata.supportedAssociatedResourceEvents?.find(
      (eventDefinition) =>
        eventDefinition.eventType === "github.pull_request.issue_comment.created",
    );
    expect(issueCommentEvent?.parameters?.some((parameter) => parameter.id === "target")).toBe(
      false,
    );
  });

  it("preserves setup start form default values from integration definitions", () => {
    const metadata = resolveTargetMetadata({
      familyId: "github",
      variantId: "github-cloud",
      displayNameOverride: null,
      descriptionOverride: null,
    });
    if (metadata.connectionMethods === undefined) {
      throw new Error("Expected GitHub target metadata to include connection methods.");
    }

    let githubAppInstallationStartFormFields:
      | readonly { defaultValue?: string | undefined; name: string }[]
      | undefined;
    for (const method of metadata.connectionMethods) {
      if (!("setupFlow" in method) || method.id !== "github-app-installation") {
        continue;
      }

      githubAppInstallationStartFormFields = method.setupFlow?.startForm?.fields;
    }

    expect(githubAppInstallationStartFormFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ownerKind",
          defaultValue: "organization",
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
