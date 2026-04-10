import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookSourceLifecycles,
} from "../types/index.js";
import { IntegrationRegistry } from "./index.js";

const ConfigSchema = z.record(z.string(), z.unknown());
const EmptySecretsSchema = z.object({});
const ApiKeyConnectionMethods = [
  {
    id: IntegrationConnectionMethodIds.API_KEY,
    label: "API key",
    kind: "form",
    secretFields: [
      {
        name: "apiKey",
        label: "API key",
        inputType: "password",
        secretType: "api_key",
        slotKey: "test.openai.api-key.api-key",
      },
    ],
  },
] as const;
const GitHubAppInstallationConnectionMethods = [
  {
    id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    label: "GitHub App installation",
    kind: "form",
    secretFields: [
      {
        name: "appPrivateKeyPem",
        label: "App private key PEM",
        inputType: "textarea",
        secretType: "api_key",
        slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
      },
      {
        name: "webhookSecret",
        label: "Webhook secret",
        inputType: "password",
        secretType: "api_key",
        slotKey: "github.github-cloud.github-app-installation.webhook-secret",
      },
    ],
    configSchema: z
      .object({
        connection_method: z.literal(IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION),
        app_id: z.string(),
        app_slug: z.string(),
        installation_id: z.string().optional(),
        setup_action: z.string().optional(),
      })
      .strict(),
  },
] as const;
const GitHubConnectionMethods = [
  ...ApiKeyConnectionMethods,
  ...GitHubAppInstallationConnectionMethods,
] as const;

describe("integration registry", () => {
  it("registers and resolves definitions by family + variant", () => {
    const registry = new IntegrationRegistry();

    registry.register({
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: ConfigSchema,
      targetSecretSchema: EmptySecretsSchema,
      bindingConfigSchema: ConfigSchema,
      connectionMethods: ApiKeyConnectionMethods,
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    const definition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai-default",
    });

    expect(definition?.displayName).toBe("OpenAI");
  });

  it("fails on duplicate family + variant registration", () => {
    const registry = new IntegrationRegistry();
    const definition: IntegrationDefinition = {
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: ConfigSchema,
      targetSecretSchema: EmptySecretsSchema,
      bindingConfigSchema: ConfigSchema,
      connectionMethods: ApiKeyConnectionMethods,
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    };

    registry.register(definition);

    expect(() => registry.register(definition)).toThrow(IntegrationDefinitionRegistryError);

    let caughtError: unknown;
    try {
      registry.register(definition);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationDefinitionRegistryError);
    expect(caughtError).toMatchObject({
      code: DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
    });
  });

  it("lists definitions in deterministic order", () => {
    const registry = new IntegrationRegistry();

    registry.registerMany([
      {
        familyId: "github",
        variantId: "github-cloud",
        kind: "git",
        displayName: "GitHub",
        logoKey: "github",
        targetConfigSchema: ConfigSchema,
        targetSecretSchema: EmptySecretsSchema,
        bindingConfigSchema: ConfigSchema,
        connectionMethods: GitHubAppInstallationConnectionMethods,
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClients: [],
        }),
      },
      {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
        displayName: "OpenAI",
        logoKey: "openai",
        targetConfigSchema: ConfigSchema,
        targetSecretSchema: EmptySecretsSchema,
        bindingConfigSchema: ConfigSchema,
        connectionMethods: ApiKeyConnectionMethods,
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClients: [],
        }),
      },
    ]);

    const listedDefinitions = registry.listDefinitions();

    expect(listedDefinitions.map((definition) => definition.familyId)).toEqual([
      "github",
      "openai",
    ]);
  });

  it("registers definitions with custom credential resolver contracts", () => {
    const registry = new IntegrationRegistry();

    registry.register({
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      displayName: "GitHub",
      logoKey: "github",
      targetConfigSchema: ConfigSchema,
      targetSecretSchema: EmptySecretsSchema,
      bindingConfigSchema: ConfigSchema,
      connectionMethods: GitHubConnectionMethods,
      credentialResolvers: {
        custom: {
          github_installation_token: {
            resolve: async (input) => ({
              value: `${input.connectionId}:${input.secretType}`,
            }),
          },
        },
      },
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    const definition = registry.getDefinition({
      familyId: "github",
      variantId: "github-cloud",
    });

    expect(definition?.credentialResolvers?.custom?.github_installation_token).toBeDefined();
  });

  it("registers definitions with oauth2 client-credentials capability", () => {
    const registry = new IntegrationRegistry();

    registry.register({
      familyId: "oauth2",
      variantId: "client-credentials-test",
      kind: "connector",
      displayName: "OAuth2 Test",
      logoKey: "oauth2",
      targetConfigSchema: ConfigSchema,
      targetSecretSchema: EmptySecretsSchema,
      bindingConfigSchema: ConfigSchema,
      connectionMethods: [
        {
          id: "oauth2-client-credentials-test",
          label: "OAuth2 client credentials",
          kind: "form",
          secretFields: [
            {
              name: "clientSecret",
              label: "Client secret",
              inputType: "password",
              secretType: "oauth2_client_secret",
              slotKey: "test.oauth2.client-credentials.client-secret",
            },
          ],
        },
      ],
      oauth2ClientCredentials: {
        exchangeClientCredentials: async (input) => ({
          accessToken: `access:${input.clientSecret}`,
        }),
      },
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    const definition = registry.getDefinition({
      familyId: "oauth2",
      variantId: "client-credentials-test",
    });

    expect(definition?.oauth2ClientCredentials).toBeDefined();
  });

  it("rejects definitions with invalid supported webhook event metadata", () => {
    const registry = new IntegrationRegistry();

    expect(() =>
      registry.register({
        familyId: "github",
        variantId: "github-cloud",
        kind: "git",
        displayName: "GitHub",
        logoKey: "github",
        targetConfigSchema: ConfigSchema,
        targetSecretSchema: EmptySecretsSchema,
        bindingConfigSchema: ConfigSchema,
        connectionMethods: GitHubConnectionMethods,
        supportedWebhookEvents: [
          {
            eventType: "github.issue_comment.created",
            providerEventType: "issue_comment",
            displayName: "",
          },
        ],
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClients: [],
        }),
      }),
    ).toThrow(IntegrationDefinitionRegistryError);
  });

  it("rejects definitions with invalid payload references", () => {
    const registry = new IntegrationRegistry();

    expect(() =>
      registry.register({
        familyId: "github",
        variantId: "github-cloud",
        kind: "git",
        displayName: "GitHub",
        logoKey: "github",
        targetConfigSchema: ConfigSchema,
        targetSecretSchema: EmptySecretsSchema,
        bindingConfigSchema: ConfigSchema,
        connectionMethods: GitHubConnectionMethods,
        supportedWebhookEvents: [
          {
            eventType: "github.issue_comment.created",
            providerEventType: "issue_comment",
            displayName: "Issue comment created",
            payloadReferences: [
              {
                path: ["repository", ""],
                description: "",
              },
            ],
          },
        ],
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClients: [],
        }),
      }),
    ).toThrow(IntegrationDefinitionRegistryError);
  });

  it("registers definitions with webhook source capability metadata", () => {
    const registry = new IntegrationRegistry();

    registry.register({
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      displayName: "GitHub",
      logoKey: "github",
      targetConfigSchema: ConfigSchema,
      targetSecretSchema: EmptySecretsSchema,
      bindingConfigSchema: ConfigSchema,
      connectionMethods: GitHubConnectionMethods,
      webhookSource: {
        lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
        async describeSource(input) {
          return {
            displayName: input.source.displayName ?? "GitHub App webhook",
            callbackUrl: `/p/integration/webhooks/${input.targetKey}`,
            providerMetadata: input.source.providerMetadata,
          };
        },
      },
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    expect(
      registry.getDefinition({
        familyId: "github",
        variantId: "github-cloud",
      })?.webhookSource,
    ).toMatchObject({
      lifecycle: "implicit",
    });
  });

  it("rejects definitions with invalid webhook source metadata", () => {
    const registry = new IntegrationRegistry();
    const definition: IntegrationDefinition = {
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      displayName: "GitHub",
      logoKey: "github",
      targetConfigSchema: ConfigSchema,
      targetSecretSchema: EmptySecretsSchema,
      bindingConfigSchema: ConfigSchema,
      connectionMethods: GitHubConnectionMethods,
      webhookSource: {
        lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
        async describeSource(input) {
          return {
            displayName: input.source.displayName ?? "GitHub App webhook",
            callbackUrl: `/p/integration/webhooks/${input.targetKey}`,
            providerMetadata: input.source.providerMetadata,
          };
        },
      },
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    };

    if (definition.webhookSource === undefined) {
      throw new Error("Expected webhookSource to be defined.");
    }

    Reflect.set(definition.webhookSource, "lifecycle", "");

    expect(() => registry.register(definition)).toThrow(IntegrationDefinitionRegistryError);
  });
});
