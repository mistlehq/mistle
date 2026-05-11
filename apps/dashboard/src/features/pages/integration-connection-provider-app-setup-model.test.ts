import type { IntegrationFormConnectionMethodProviderAppSetup } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  buildProviderAppSetupConfig,
  buildProviderAppSetupConfigFieldInputs,
  buildProviderAppSetupSecretFieldInputs,
  buildProviderAppSetupSecretUpdates,
  buildProviderAppSetupStartBody,
  createInitialProviderAppSetupDraft,
  hasProviderAppSetupDraftValues,
  isProviderAppRequiredDraftComplete,
} from "./integration-connection-provider-app-setup-model.js";

const ProviderAppSetup = {
  title: "Choose a setup method",
  description: "Create or connect a provider app.",
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
  existingApp: {
    title: "Existing Provider App",
    description: "Paste values from an existing provider app.",
    connectLabel: "Connect provider app",
    installedDetection: {
      configFields: ["clientId"],
      secretFields: ["botToken"],
    },
    saveErrorMessage: "Could not save provider app setup.",
    configFields: [
      {
        configKey: "client_id",
        name: "clientId",
        label: "Client ID",
        required: false,
      },
    ],
    secretFields: [
      {
        inputType: "password",
        name: "botToken",
        label: "Bot token",
        placeholder: "token-...",
        required: true,
        secretLabel: "bot token",
      },
      {
        inputType: "password",
        name: "clientSecret",
        label: "Client secret (Linked User Auth)",
        required: false,
        secretLabel: "client secret",
      },
    ],
  },
  urls: {
    title: "Provider app URLs",
    description: "Copy this URL into the provider app.",
    webhookCallback: {
      label: "Webhook URL",
      errorTitle: "Could not load webhook URL",
      missingTitle: "Webhook URL is not available yet",
      missingMessage: "Setup requires a webhook URL.",
    },
  },
} satisfies IntegrationFormConnectionMethodProviderAppSetup;

const ProviderConnection = {
  id: "icn_provider_setup",
  targetKey: "provider-default",
  displayName: "Provider connection",
  status: "active",
  connectionMethodId: "provider-app",
  connectionMethodLabel: "Provider app",
  config: {
    connection_method: "provider-app",
    client_id: "123.456",
  },
  configuredSecretNames: ["botToken"],
  createdAt: "2026-04-26T00:00:00.000Z",
  updatedAt: "2026-04-26T00:00:00.000Z",
} satisfies IntegrationConnection;

const RequiredConfigProviderAppSetup = {
  ...ProviderAppSetup,
  existingApp: {
    ...ProviderAppSetup.existingApp,
    installedDetection: {
      configFields: ["appId", "appSlug", "clientId"],
      secretFields: ["appPrivateKeyPem"],
    },
    configFields: [
      {
        configKey: "app_id",
        name: "appId",
        label: "App ID",
        required: true,
      },
      {
        configKey: "app_slug",
        name: "appSlug",
        label: "App slug",
        required: true,
      },
      {
        configKey: "client_id",
        name: "clientId",
        label: "Client ID",
        required: true,
      },
    ],
    secretFields: [
      {
        inputType: "textarea",
        name: "appPrivateKeyPem",
        label: "App private key",
        required: true,
        secretLabel: "app private key",
      },
      {
        inputType: "password",
        name: "webhookSecret",
        label: "Webhook secret",
        required: false,
        secretLabel: "webhook secret",
      },
    ],
  },
} satisfies IntegrationFormConnectionMethodProviderAppSetup;

describe("provider app setup model", () => {
  it("derives draft values from provider metadata", () => {
    expect(
      createInitialProviderAppSetupDraft({
        connection: ProviderConnection,
        providerAppSetup: ProviderAppSetup,
      }),
    ).toEqual({
      clientId: "123.456",
      botToken: "",
      clientSecret: "",
    });
    expect(
      hasProviderAppSetupDraftValues({
        connection: ProviderConnection,
        providerAppSetup: ProviderAppSetup,
      }),
    ).toBe(true);
  });

  it("builds config and secret payloads from provider field mappings", () => {
    const draft = {
      clientId: " 123.456 ",
      botToken: " xoxb-token ",
      clientSecret: "",
    };

    expect(
      buildProviderAppSetupConfig({
        methodId: "provider-app",
        draft,
        providerAppSetup: ProviderAppSetup,
      }),
    ).toEqual({
      connection_method: "provider-app",
      client_id: "123.456",
    });
    expect(
      buildProviderAppSetupSecretUpdates({
        draft,
        providerAppSetup: ProviderAppSetup,
      }),
    ).toEqual({
      botToken: "xoxb-token",
    });
  });

  it("requires draft values for required config and unconfigured required secrets before connect", () => {
    expect(
      isProviderAppRequiredDraftComplete({
        configuredSecretFieldKeys: new Set(),
        draft: {
          appId: "123",
          appSlug: "",
          clientId: "Iv1.client123",
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----",
          webhookSecret: "",
        },
        providerAppSetup: RequiredConfigProviderAppSetup,
      }),
    ).toBe(false);
    expect(
      isProviderAppRequiredDraftComplete({
        configuredSecretFieldKeys: new Set(),
        draft: {
          appId: "123",
          appSlug: "mistle-github-app",
          clientId: "Iv1.client123",
          appPrivateKeyPem: "",
          webhookSecret: "",
        },
        providerAppSetup: RequiredConfigProviderAppSetup,
      }),
    ).toBe(false);
    expect(
      isProviderAppRequiredDraftComplete({
        configuredSecretFieldKeys: new Set(["appPrivateKeyPem"]),
        draft: {
          appId: "123",
          appSlug: "mistle-github-app",
          clientId: "Iv1.client123",
          appPrivateKeyPem: "",
          webhookSecret: "",
        },
        providerAppSetup: RequiredConfigProviderAppSetup,
      }),
    ).toBe(true);
  });

  it("builds provider app manifest start body from provider metadata and start form values", () => {
    expect(
      buildProviderAppSetupStartBody({
        manifest: {
          display_information: {
            name: "Provider app",
          },
        },
        providerAppSetup: ProviderAppSetup,
        setupStartFormFields: [
          {
            name: "appConfigToken",
            required: true,
          },
          {
            name: "optionalNote",
          },
        ],
        setupStartFormState: {
          values: {
            appConfigToken: "token-value",
          },
          isFieldVisible: () => true,
          resolveRequiredValue: (fieldName) => {
            if (fieldName !== "appConfigToken") {
              throw new Error(`Unexpected required field '${fieldName}'.`);
            }

            return "token-value";
          },
        },
      }),
    ).toEqual({
      manifest: {
        display_information: {
          name: "Provider app",
        },
      },
      appConfigToken: "token-value",
      optionalNote: "",
    });
  });

  it("omits hidden provider app manifest start form fields", () => {
    expect(
      buildProviderAppSetupStartBody({
        manifest: {
          name: "Provider app",
        },
        providerAppSetup: ProviderAppSetup,
        setupStartFormFields: [
          {
            name: "ownerKind",
            required: true,
          },
          {
            name: "organizationSlug",
            required: true,
          },
        ],
        setupStartFormState: {
          values: {
            ownerKind: "personal",
            organizationSlug: "",
          },
          isFieldVisible: (fieldName) => fieldName !== "organizationSlug",
          resolveRequiredValue: (fieldName) => {
            if (fieldName !== "ownerKind") {
              throw new Error(`Unexpected required field '${fieldName}'.`);
            }

            return "personal";
          },
        },
      }),
    ).toEqual({
      manifest: {
        name: "Provider app",
      },
      ownerKind: "personal",
    });
  });

  it("builds stable existing app field inputs for the generic pane", () => {
    const draft = {
      clientId: "123.456",
      botToken: "",
      clientSecret: "",
    };

    expect(
      buildProviderAppSetupConfigFieldInputs({
        draft,
        providerAppSetup: ProviderAppSetup,
        routeSegment: "provider-app",
      }),
    ).toEqual([
      {
        fieldKey: "clientId",
        id: "provider-app-clientId",
        label: "Client ID",
        required: false,
        value: "123.456",
      },
    ]);
    expect(
      buildProviderAppSetupSecretFieldInputs({
        configuredSecretFieldKeys: new Set(["botToken"]),
        draft,
        providerAppSetup: ProviderAppSetup,
        routeSegment: "provider-app",
      }),
    ).toEqual([
      {
        configured: true,
        fieldKey: "botToken",
        id: "provider-app-botToken",
        label: "Bot token",
        placeholder: "token-...",
        required: false,
        secretLabel: "bot token",
        type: "password",
        value: "",
      },
      {
        configured: false,
        fieldKey: "clientSecret",
        id: "provider-app-clientSecret",
        label: "Client secret (Linked User Auth)",
        required: false,
        secretLabel: "client secret",
        type: "password",
        value: "",
      },
    ]);
    expect(
      buildProviderAppSetupSecretUpdates({
        draft: {
          clientId: "123.456",
          botToken: "",
          clientSecret: "",
        },
        providerAppSetup: ProviderAppSetup,
      }),
    ).toBeUndefined();
  });
});
