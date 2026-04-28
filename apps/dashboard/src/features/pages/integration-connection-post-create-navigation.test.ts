import { describe, expect, it } from "vitest";

import { resolveDraftThenSetupConnectionPath } from "./integration-connection-post-create-navigation.js";

describe("resolveDraftThenSetupConnectionPath", () => {
  it("builds setup routes from draft setup method metadata", () => {
    const path = resolveDraftThenSetupConnectionPath({
      connectionId: "icn_slack_draft",
      editor: {
        mode: "create",
        targetKey: "slack-default",
        targetDisplayName: "Slack",
        targetFamilyId: "slack",
        targetVariantId: "slack-default",
        targetConfig: {},
        methods: [
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
      },
      methodId: "slack-bot-token",
    });

    expect(path).toBe("/integrations/slack-default/icn_slack_draft/slack-app/setup");
  });

  it("returns null for single-step methods", () => {
    const path = resolveDraftThenSetupConnectionPath({
      connectionId: "icn_api_key",
      editor: {
        mode: "create",
        targetKey: "github-cloud",
        targetDisplayName: "GitHub",
        targetFamilyId: "github",
        targetVariantId: "github-cloud",
        targetConfig: {},
        methods: [
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
      },
      methodId: "api-key",
    });

    expect(path).toBeNull();
  });

  it("fails fast when draft setup methods omit setup flow metadata", () => {
    expect(() =>
      resolveDraftThenSetupConnectionPath({
        connectionId: "icn_slack_draft",
        editor: {
          mode: "create",
          targetKey: "slack-default",
          targetDisplayName: "Slack",
          targetFamilyId: "slack",
          targetVariantId: "slack-default",
          targetConfig: {},
          methods: [
            {
              id: "slack-bot-token",
              label: "Slack app",
              kind: "form",
              createBehavior: "draft-then-setup",
              secretFields: [
                {
                  name: "botToken",
                  label: "Bot token",
                  inputType: "password",
                },
              ],
            },
          ],
        },
        methodId: "slack-bot-token",
      }),
    ).toThrow(
      "Draft-then-setup connection method 'slack-bot-token' is missing setupFlow metadata.",
    );
  });
});
