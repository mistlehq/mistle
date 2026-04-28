import { describe, expect, it } from "vitest";

import type { IntegrationConnectionMethod } from "../integrations/integration-connection-editor.js";
import { resolveIncompleteIntegrationConnectionSetupFlow } from "./integration-connection-setup-state.js";

const CreatedAt = "2026-04-28T00:00:00.000Z";
const UpdatedAt = "2026-04-28T00:00:00.000Z";

const SlackAppMethod: IntegrationConnectionMethod = {
  id: "slack-bot-token",
  label: "Slack app",
  kind: "form",
  createBehavior: "draft-then-setup",
  setupFlow: {
    completionRequirements: {
      kind: "all-of",
      allOf: [
        {
          kind: "secret-field",
          field: "botToken",
        },
        {
          kind: "secret-field",
          field: "signingSecret",
        },
      ],
    },
    routeSegment: "slack-app",
  },
  secretFields: [
    {
      name: "botToken",
      label: "Bot token",
      inputType: "password",
    },
  ],
};

const GitHubAppMethod: IntegrationConnectionMethod = {
  id: "github-app-installation",
  label: "GitHub App installation",
  kind: "form",
  createBehavior: "draft-then-setup",
  setupFlow: {
    completionRequirements: {
      kind: "any-of",
      anyOf: [
        {
          kind: "config-field",
          field: "installation_id",
        },
        {
          kind: "connection-external-subject",
        },
      ],
    },
    routeSegment: "github-app",
  },
  secretFields: [
    {
      name: "webhookSecret",
      label: "Webhook secret",
      inputType: "password",
    },
  ],
};

describe("resolveIncompleteIntegrationConnectionSetupFlow", () => {
  it("returns the setup flow while required secrets are missing", () => {
    const setupFlow = resolveIncompleteIntegrationConnectionSetupFlow({
      connectionMethods: [SlackAppMethod],
      connection: {
        createdAt: CreatedAt,
        id: "icn_slack",
        targetKey: "slack-default",
        displayName: "Slack",
        status: "active",
        connectionMethodId: "slack-bot-token",
        configuredSecretNames: ["botToken"],
        updatedAt: UpdatedAt,
      },
    });

    expect(setupFlow).toEqual({
      routeSegment: "slack-app",
    });
  });

  it("returns null when all setup completion requirements are met", () => {
    const setupFlow = resolveIncompleteIntegrationConnectionSetupFlow({
      connectionMethods: [SlackAppMethod],
      connection: {
        createdAt: CreatedAt,
        id: "icn_slack",
        targetKey: "slack-default",
        displayName: "Slack",
        status: "active",
        connectionMethodId: "slack-bot-token",
        configuredSecretNames: ["botToken", "signingSecret"],
        updatedAt: UpdatedAt,
      },
    });

    expect(setupFlow).toBeNull();
  });

  it("supports GitHub setup completion through an installation id", () => {
    const setupFlow = resolveIncompleteIntegrationConnectionSetupFlow({
      connectionMethods: [GitHubAppMethod],
      connection: {
        createdAt: CreatedAt,
        id: "icn_github",
        targetKey: "github-cloud",
        displayName: "GitHub",
        status: "active",
        connectionMethodId: "github-app-installation",
        config: {
          installation_id: "12345",
        },
        updatedAt: UpdatedAt,
      },
    });

    expect(setupFlow).toBeNull();
  });

  it("supports GitHub setup completion through an external subject id", () => {
    const setupFlow = resolveIncompleteIntegrationConnectionSetupFlow({
      connectionMethods: [GitHubAppMethod],
      connection: {
        createdAt: CreatedAt,
        id: "icn_github",
        targetKey: "github-cloud",
        displayName: "GitHub",
        status: "active",
        connectionMethodId: "github-app-installation",
        externalSubjectId: "12345",
        updatedAt: UpdatedAt,
      },
    });

    expect(setupFlow).toBeNull();
  });

  it("returns null for single-step methods", () => {
    const setupFlow = resolveIncompleteIntegrationConnectionSetupFlow({
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
            },
          ],
        },
      ],
      connection: {
        createdAt: CreatedAt,
        id: "icn_api_key",
        targetKey: "github-cloud",
        displayName: "GitHub",
        status: "active",
        connectionMethodId: "api-key",
        updatedAt: UpdatedAt,
      },
    });

    expect(setupFlow).toBeNull();
  });

  it("fails fast when draft setup methods omit completion metadata", () => {
    expect(() =>
      resolveIncompleteIntegrationConnectionSetupFlow({
        connectionMethods: [
          {
            id: "slack-bot-token",
            label: "Slack app",
            kind: "form",
            createBehavior: "draft-then-setup",
            setupFlow: {
              routeSegment: "slack-app",
            },
            secretFields: [
              {
                name: "botToken",
                label: "Bot token",
                inputType: "password",
              },
            ],
          },
        ],
        connection: {
          createdAt: CreatedAt,
          id: "icn_slack",
          targetKey: "slack-default",
          displayName: "Slack",
          status: "active",
          connectionMethodId: "slack-bot-token",
          updatedAt: UpdatedAt,
        },
      }),
    ).toThrow(
      "Draft-then-setup connection method 'slack-bot-token' is missing setup completion metadata.",
    );
  });
});
