import { describe, expect, it } from "vitest";

import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "../types/index.js";
import {
  isWebhookTriggerSupportedByCapabilities,
  parseWebhookTriggerCapabilitiesProviderMetadata,
  resolveWebhookTriggerCapabilityEvents,
} from "./index.js";

describe("webhook trigger capabilities", () => {
  it("allows a trigger when any requirement alternative is satisfied", () => {
    expect(
      isWebhookTriggerSupportedByCapabilities({
        capabilities: {
          events: ["message.groups"],
          permissions: [{ permission: "groups:history" }],
        },
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
      }),
    ).toBe(true);
  });

  it("requires all permissions in a matching requirement set", () => {
    expect(
      isWebhookTriggerSupportedByCapabilities({
        capabilities: {
          events: ["jira:issue_created"],
          permissions: [{ permission: "read:jira-work" }],
        },
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
      }),
    ).toBe(false);
  });

  it("matches permission access exactly when access is required", () => {
    expect(
      isWebhookTriggerSupportedByCapabilities({
        capabilities: {
          events: ["pull_request"],
          permissions: [{ permission: "pull_requests" }],
        },
        requirements: {
          anyOf: [
            {
              event: "pull_request",
              permissions: [{ permission: "pull_requests", access: "read" }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("allows any permission access when access is not required", () => {
    expect(
      isWebhookTriggerSupportedByCapabilities({
        capabilities: {
          events: ["issues"],
          permissions: [{ permission: "issues", access: "read" }],
        },
        requirements: {
          anyOf: [
            {
              event: "issues",
              permissions: [{ permission: "issues" }],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("allows triggers without capability requirements when capabilities are missing", () => {
    expect(
      isWebhookTriggerSupportedByCapabilities({
        capabilities: undefined,
        requirements: undefined,
      }),
    ).toBe(true);
  });

  it("rejects triggers with capability requirements when capabilities are missing", () => {
    expect(
      isWebhookTriggerSupportedByCapabilities({
        capabilities: undefined,
        requirements: {
          anyOf: [
            {
              event: "pull_request",
              permissions: [{ permission: "pull_requests", access: "read" }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("parses capability provider metadata", () => {
    expect(
      parseWebhookTriggerCapabilitiesProviderMetadata({
        [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
          events: ["issues"],
          permissions: [{ permission: "issues", access: "read" }],
        },
      }),
    ).toEqual({
      events: ["issues"],
      permissions: [{ permission: "issues", access: "read" }],
    });
  });

  it("returns every supported event with status from current capabilities", () => {
    const events = resolveWebhookTriggerCapabilityEvents({
      capabilities: {
        events: ["pull_request"],
        permissions: [{ permission: "pull_requests", access: "read" }],
      },
      supportedWebhookEvents: [
        {
          displayName: "Pull request opened",
          eventType: "github.pull_request.opened",
          providerEventType: "pull_request",
          requirements: {
            anyOf: [
              {
                event: "pull_request",
                permissions: [{ permission: "pull_requests", access: "read" }],
              },
            ],
          },
        },
        {
          displayName: "Push",
          eventType: "github.push.pushed",
          providerEventType: "push",
          requirements: {
            anyOf: [
              {
                event: "push",
                permissions: [{ permission: "contents", access: "read" }],
              },
            ],
          },
        },
      ],
    });

    expect(
      events.map((event) => ({
        eventType: event.eventDefinition.eventType,
        satisfiedRequirementSet: event.satisfiedRequirementSet,
        status: event.status,
        unsatisfiedRequirementSets: event.unsatisfiedRequirementSets,
      })),
    ).toEqual([
      {
        eventType: "github.pull_request.opened",
        satisfiedRequirementSet: {
          event: "pull_request",
          permissions: [{ permission: "pull_requests", access: "read" }],
        },
        status: "enabled",
        unsatisfiedRequirementSets: [],
      },
      {
        eventType: "github.push.pushed",
        satisfiedRequirementSet: undefined,
        status: "not_enabled",
        unsatisfiedRequirementSets: [
          {
            event: "push",
            permissions: [{ permission: "contents", access: "read" }],
          },
        ],
      },
    ]);
  });
});
