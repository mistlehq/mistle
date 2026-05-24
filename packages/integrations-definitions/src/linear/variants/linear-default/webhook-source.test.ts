import { describe, expect, it } from "vitest";

import {
  parseLinearWebhookCreateResponse,
  parseLinearWebhookDeleteResponse,
  parseLinearWebhookListResponse,
} from "./webhook-source.server.js";

describe("Linear webhook source GraphQL response parsing", () => {
  it("extracts created webhook registration data", () => {
    expect(
      parseLinearWebhookCreateResponse({
        data: {
          webhookCreate: {
            success: true,
            webhook: {
              id: "linear-webhook-id",
              enabled: true,
            },
          },
        },
      }),
    ).toEqual({
      remoteRegistrationId: "linear-webhook-id",
      enabled: true,
    });
  });

  it("fails creation on GraphQL errors", () => {
    expect(() =>
      parseLinearWebhookCreateResponse({
        errors: [
          {
            message: "Authentication required",
          },
        ],
      }),
    ).toThrow("Linear webhook creation failed: Authentication required");
  });

  it("fails creation when the webhook id is absent", () => {
    expect(() =>
      parseLinearWebhookCreateResponse({
        data: {
          webhookCreate: {
            success: true,
            webhook: null,
          },
        },
      }),
    ).toThrow("Linear webhook creation response is missing webhook.");
  });

  it("accepts successful deletion responses", () => {
    expect(() =>
      parseLinearWebhookDeleteResponse({
        data: {
          webhookDelete: {
            success: true,
          },
        },
      }),
    ).not.toThrow();
  });

  it("fails deletion on GraphQL errors", () => {
    expect(() =>
      parseLinearWebhookDeleteResponse({
        errors: [
          {
            message: "Webhook not found",
          },
        ],
      }),
    ).toThrow("Linear webhook deletion failed: Webhook not found");
  });

  it("extracts listed webhook registration state for provider-verified refresh", () => {
    expect(
      parseLinearWebhookListResponse({
        data: {
          webhooks: {
            nodes: [
              {
                id: "linear-webhook-id",
                enabled: true,
                allPublicTeams: true,
                label: "Mistle webhook source iws_linear",
                resourceTypes: ["Issue", "Comment"],
                team: null,
                teamIds: null,
                url: "https://control-plane.example.com/p/integration/webhooks/linear-default/ep",
              },
            ],
            pageInfo: {
              hasNextPage: true,
              endCursor: "linear-webhook-id",
            },
          },
        },
      }),
    ).toEqual({
      nodes: [
        {
          id: "linear-webhook-id",
          enabled: true,
          allPublicTeams: true,
          label: "Mistle webhook source iws_linear",
          resourceTypes: ["Issue", "Comment"],
          team: null,
          teamIds: null,
          url: "https://control-plane.example.com/p/integration/webhooks/linear-default/ep",
        },
      ],
      hasNextPage: true,
      endCursor: "linear-webhook-id",
    });
  });

  it("fails webhook listing on GraphQL errors", () => {
    expect(() =>
      parseLinearWebhookListResponse({
        errors: [
          {
            message: "Authentication required",
          },
        ],
      }),
    ).toThrow("Linear webhook list failed: Authentication required");
  });
});
