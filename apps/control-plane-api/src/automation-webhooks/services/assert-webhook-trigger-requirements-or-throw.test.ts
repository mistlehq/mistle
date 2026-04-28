import { BadRequestError } from "@mistle/http/errors.js";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";
import { assertWebhookTriggerRequirementsOrThrow } from "./assert-webhook-trigger-requirements-or-throw.js";

describe("assertWebhookTriggerRequirementsOrThrow", () => {
  it("allows a selected trigger when one requirement alternative is satisfied", () => {
    expect(() =>
      assertWebhookTriggerRequirementsOrThrow({
        eventTypes: ["slack:message"],
        providerMetadata: {
          [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
            events: ["message.groups"],
            permissions: [{ permission: "groups:history" }],
          },
        },
        supportedWebhookEvents: [
          {
            eventType: "slack:message",
            providerEventType: "message",
            displayName: "Message",
            requirements: {
              anyOf: [
                {
                  event: "message.channels",
                  permissions: [{ permission: "channels:history" }],
                },
                {
                  event: "message.groups",
                  permissions: [{ permission: "groups:history" }],
                },
              ],
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a selected trigger when its requirements are not satisfied", () => {
    expect(() =>
      assertWebhookTriggerRequirementsOrThrow({
        eventTypes: ["github.pull_request.opened"],
        providerMetadata: {
          [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
            events: ["issues"],
            permissions: [{ permission: "issues", access: "read" }],
          },
        },
        supportedWebhookEvents: [
          {
            eventType: "github.pull_request.opened",
            providerEventType: "pull_request",
            displayName: "Pull request opened",
            requirements: {
              anyOf: [
                {
                  event: "pull_request",
                  permissions: [{ permission: "pull_requests", access: "read" }],
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(BadRequestError);
  });

  it("uses the invalid trigger requirements bad request code", () => {
    const error = captureError(() =>
      assertWebhookTriggerRequirementsOrThrow({
        eventTypes: ["jira:issue_created"],
        providerMetadata: {
          [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
            events: ["jira:issue_created"],
            permissions: [{ permission: "read:jira-work" }],
          },
        },
        supportedWebhookEvents: [
          {
            eventType: "jira:issue_created",
            providerEventType: "jira:issue_created",
            displayName: "Issue created",
            requirements: {
              anyOf: [
                {
                  event: "jira:issue_created",
                  permissions: [
                    { permission: "read:jira-work" },
                    { permission: "manage:jira-webhook" },
                  ],
                },
              ],
            },
          },
        ],
      }),
    );

    expect(error).toBeInstanceOf(BadRequestError);
    if (!(error instanceof BadRequestError)) {
      throw new Error("Expected trigger requirements assertion to fail with BadRequestError.");
    }

    expect(error.code).toBe(AutomationWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_REQUIREMENTS);
  });

  it("allows existing sources without capability metadata", () => {
    expect(() =>
      assertWebhookTriggerRequirementsOrThrow({
        eventTypes: ["github.pull_request.opened"],
        providerMetadata: {},
        supportedWebhookEvents: [
          {
            eventType: "github.pull_request.opened",
            providerEventType: "pull_request",
            displayName: "Pull request opened",
            requirements: {
              anyOf: [
                {
                  event: "pull_request",
                  permissions: [{ permission: "pull_requests", access: "read" }],
                },
              ],
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("validates all advertised triggers when eventTypes is null", () => {
    expect(() =>
      assertWebhookTriggerRequirementsOrThrow({
        eventTypes: null,
        providerMetadata: {
          [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
            events: ["issues"],
            permissions: [{ permission: "issues", access: "read" }],
          },
        },
        supportedWebhookEvents: [
          {
            eventType: "github.issues.opened",
            providerEventType: "issues",
            displayName: "Issue opened",
            requirements: {
              anyOf: [
                {
                  event: "issues",
                  permissions: [{ permission: "issues", access: "read" }],
                },
              ],
            },
          },
          {
            eventType: "github.pull_request.opened",
            providerEventType: "pull_request",
            displayName: "Pull request opened",
            requirements: {
              anyOf: [
                {
                  event: "pull_request",
                  permissions: [{ permission: "pull_requests", access: "read" }],
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(BadRequestError);
  });
});

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  return undefined;
}
