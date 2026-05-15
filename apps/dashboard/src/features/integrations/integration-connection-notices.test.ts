import { describe, expect, it } from "vitest";

import { resolveInstalledIntegrationConnectionNotice } from "./integration-connection-notices.js";
import type { IntegrationConnectionMethod } from "./integrations-service-shared.js";

const ProviderAppConnectionMethod: IntegrationConnectionMethod = {
  id: "provider-app",
  label: "Provider app",
  kind: "form",
  secretFields: [
    {
      inputType: "password",
      label: "API secret",
      name: "apiSecret",
      optional: false,
      slotKey: "api-secret",
    },
  ],
  setupFlow: {
    routeSegment: "provider-app",
    providerAppSetup: {
      title: "Choose a setup method",
      description: "Create or connect a provider app.",
      installedNoticeTitle: "Provider app connected successfully",
      existingApp: {
        title: "Existing Provider App",
        description: "Paste values from an existing provider app.",
        connectLabel: "Connect provider app",
        installedDetection: {
          configFields: ["clientId"],
          secretFields: ["apiSecret"],
        },
        saveErrorMessage: "Could not save provider app setup.",
        configFields: [
          {
            configKey: "client_id",
            name: "clientId",
            label: "Client ID",
            required: true,
          },
        ],
        secretFields: [
          {
            inputType: "password",
            name: "apiSecret",
            label: "API secret",
            required: true,
            secretLabel: "API secret",
          },
        ],
      },
      manifest: {
        title: "Provider app manifest",
        description: "Create a provider app from a manifest.",
        createErrorMessage: "Could not create provider app manifest.",
        startAction: {
          expectedResultKind: "redirect",
          manifestBodyField: "manifest",
          unexpectedResultMessage: "Provider app manifest setup did not return a redirect URL.",
        },
      },
      urls: {
        title: "Provider app URLs",
        description: "Copy these URLs into the provider app.",
        webhookCallback: {
          label: "Webhook URL",
          errorTitle: "Could not load webhook URL",
          missingTitle: "Webhook URL is not available yet",
          missingMessage: "Setup requires a webhook URL.",
        },
      },
    },
  },
};

const PlainConnectionMethod: IntegrationConnectionMethod = {
  id: "plain-form",
  label: "Plain form",
  kind: "form",
  secretFields: [
    {
      inputType: "password",
      label: "API secret",
      name: "apiSecret",
      optional: false,
      slotKey: "api-secret",
    },
  ],
};

describe("resolveInstalledIntegrationConnectionNotice", () => {
  it("resolves the reauthorized notice for the selected connection", () => {
    expect(
      resolveInstalledIntegrationConnectionNotice({
        connectionMethods: [PlainConnectionMethod],
        detailConnectionId: "connection_1",
        searchParams: new URLSearchParams("connectionNotice=reauthorized"),
        selectedConnection: {
          connectionMethodId: "plain-form",
          id: "connection_1",
        },
      }),
    ).toEqual({
      connectionId: "connection_1",
      resetKey: "reauthorized:connection_1",
      title: "Re-authorized",
      variant: "success",
    });
  });

  it("resolves the installed notice from provider app setup metadata", () => {
    expect(
      resolveInstalledIntegrationConnectionNotice({
        connectionMethods: [ProviderAppConnectionMethod],
        detailConnectionId: "connection_1",
        searchParams: new URLSearchParams("connectionNotice=installed"),
        selectedConnection: {
          connectionMethodId: "provider-app",
          id: "connection_1",
        },
      }),
    ).toEqual({
      connectionId: "connection_1",
      resetKey: "provider-app-installed:provider-app:connection_1",
      title: "Provider app connected successfully",
      variant: "success",
    });
  });

  it("ignores installed notices when the selected method has no provider app notice metadata", () => {
    expect(
      resolveInstalledIntegrationConnectionNotice({
        connectionMethods: [PlainConnectionMethod],
        detailConnectionId: "connection_1",
        searchParams: new URLSearchParams("connectionNotice=installed"),
        selectedConnection: {
          connectionMethodId: "plain-form",
          id: "connection_1",
        },
      }),
    ).toBeNull();
  });
});
