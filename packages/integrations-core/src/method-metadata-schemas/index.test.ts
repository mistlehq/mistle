import { describe, expect, it } from "vitest";

import {
  IntegrationConnectionMethodDetailMetadataSchema,
  IntegrationFormConnectionMethodPostCreateMetadataSchema,
  IntegrationFormConnectionMethodSetupFlowMetadataSchema,
} from "./index.js";

describe("integration method metadata schemas", () => {
  it("parses strict connection detail metadata", () => {
    expect(() =>
      IntegrationConnectionMethodDetailMetadataSchema.parse({
        installation: {
          fields: [
            {
              label: "Installation ID",
              source: {
                kind: "first-of",
                sources: [
                  {
                    kind: "config-field",
                    field: "installation_id",
                  },
                  {
                    kind: "connection-external-subject",
                  },
                ],
              },
            },
          ],
          hideWebhookSourceSection: true,
          includeWebhookCallbackUrl: true,
        },
      }),
    ).not.toThrow();
  });

  it("parses strict form post-create metadata", () => {
    expect(
      IntegrationFormConnectionMethodPostCreateMetadataSchema.parse({
        managedWebhookSource: {
          autoCreate: true,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Connection and webhook created",
        },
      }),
    ).toEqual({
      managedWebhookSource: {
        autoCreate: true,
        failureNoticeTitle: "Connection created, webhook setup failed",
        successNoticeTitle: "Connection and webhook created",
      },
    });
  });

  it("parses strict setup flow metadata", () => {
    expect(
      IntegrationFormConnectionMethodSetupFlowMetadataSchema.parse({
        routeSegment: "provider-app",
        startForm: {
          submitLabel: "Create app",
          fields: [
            {
              name: "appConfigToken",
              label: "App configuration token",
              inputType: "password",
              required: true,
              placeholder: "xoxe.xoxp-...",
              description: "Generate a provider app configuration token.",
              actions: [
                {
                  label: "Generate token",
                  href: "https://api.slack.com/apps",
                  opensInNewWindow: true,
                },
              ],
            },
          ],
        },
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "connection-external-subject",
            },
            {
              kind: "secret-field",
              field: "webhookSecret",
            },
          ],
        },
      }),
    ).toEqual({
      routeSegment: "provider-app",
      startForm: {
        submitLabel: "Create app",
        fields: [
          {
            name: "appConfigToken",
            label: "App configuration token",
            inputType: "password",
            required: true,
            placeholder: "xoxe.xoxp-...",
            description: "Generate a provider app configuration token.",
            actions: [
              {
                label: "Generate token",
                href: "https://api.slack.com/apps",
                opensInNewWindow: true,
              },
            ],
          },
        ],
      },
      completionRequirements: {
        kind: "all-of",
        allOf: [
          {
            kind: "connection-external-subject",
          },
          {
            kind: "secret-field",
            field: "webhookSecret",
          },
        ],
      },
    });
  });
});
