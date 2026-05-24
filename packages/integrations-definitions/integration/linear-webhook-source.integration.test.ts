import { parseWebhookTriggerCapabilitiesProviderMetadata } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { LinearManagedWebhookResourceTypes } from "../src/linear/variants/linear-default/supported-webhook-events.js";
import { LinearWebhookSourceCapability } from "../src/linear/variants/linear-default/webhook-source.server.js";

const LinearTestApiKey = process.env.LINEAR_TEST_API_KEY;
const LinearTestCallbackBaseUrl = process.env.LINEAR_TEST_CALLBACK_BASE_URL;

// This is a live provider integration: CI runs the file, and the scenario only executes
// in environments that intentionally provide Linear credentials and a public callback URL.
const describeLive =
  LinearTestApiKey !== undefined && LinearTestCallbackBaseUrl !== undefined
    ? describe
    : describe.skip;

describeLive("Linear webhook source provider integration", () => {
  it("creates and deletes a Linear webhook registration", async () => {
    if (LinearTestApiKey === undefined || LinearTestCallbackBaseUrl === undefined) {
      throw new Error("Expected Linear live test environment variables to be set.");
    }

    if (LinearWebhookSourceCapability.createRegistration === undefined) {
      throw new Error("Expected Linear webhook source lifecycle hooks to be configured.");
    }
    if (LinearWebhookSourceCapability.refreshTriggerCapabilities === undefined) {
      throw new Error("Expected Linear webhook trigger capability refresh to be configured.");
    }
    if (LinearWebhookSourceCapability.deleteRegistration === undefined) {
      throw new Error("Expected Linear webhook source lifecycle hooks to be configured.");
    }

    const sourceId = `linear-live-${Date.now().toString()}`;
    const created = await LinearWebhookSourceCapability.createRegistration({
      organizationId: "linear-live-organization",
      targetKey: "linear-default",
      controlPlaneBaseUrl: LinearTestCallbackBaseUrl,
      target: {
        familyId: "linear",
        variantId: "linear-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "linear-live-connection",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      connectionSecrets: {
        apiKey: LinearTestApiKey,
      },
      source: {
        id: sourceId,
        targetKey: "linear-default",
        organizationId: "linear-live-organization",
        integrationConnectionId: "linear-live-connection",
        endpointKey: sourceId,
        providerMetadata: {},
      },
      webhookSecret: "linear-live-webhook-secret",
    });

    try {
      expect(created.remoteRegistrationId).toEqual(expect.any(String));
      expect(created.providerMetadata).toEqual(
        expect.objectContaining({
          allPublicTeams: true,
          registeredResourceTypes: LinearManagedWebhookResourceTypes,
          webhookEnabled: true,
        }),
      );

      const refreshed = await LinearWebhookSourceCapability.refreshTriggerCapabilities({
        organizationId: "linear-live-organization",
        targetKey: "linear-default",
        controlPlaneBaseUrl: LinearTestCallbackBaseUrl,
        target: {
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "linear-live-connection",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
        connectionSecrets: {
          apiKey: LinearTestApiKey,
        },
        source: {
          id: sourceId,
          targetKey: "linear-default",
          organizationId: "linear-live-organization",
          integrationConnectionId: "linear-live-connection",
          endpointKey: sourceId,
          remoteRegistrationId: created.remoteRegistrationId,
          providerMetadata: created.providerMetadata ?? {},
        },
        body: {},
      });
      expect(refreshed.providerMetadata).toEqual(
        expect.objectContaining({
          allPublicTeams: true,
          registeredResourceTypes: LinearManagedWebhookResourceTypes,
          webhookEnabled: true,
        }),
      );
      expect(
        parseWebhookTriggerCapabilitiesProviderMetadata(refreshed.providerMetadata ?? {})?.events,
      ).toEqual(LinearManagedWebhookResourceTypes);
    } finally {
      await LinearWebhookSourceCapability.deleteRegistration({
        organizationId: "linear-live-organization",
        targetKey: "linear-default",
        controlPlaneBaseUrl: LinearTestCallbackBaseUrl,
        target: {
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "linear-live-connection",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
        connectionSecrets: {
          apiKey: LinearTestApiKey,
        },
        source: {
          id: sourceId,
          targetKey: "linear-default",
          organizationId: "linear-live-organization",
          integrationConnectionId: "linear-live-connection",
          endpointKey: sourceId,
          remoteRegistrationId: created.remoteRegistrationId,
          providerMetadata: created.providerMetadata ?? {},
        },
      });
    }
  });
});
