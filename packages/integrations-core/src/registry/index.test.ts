import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import {
  IntegrationConnectionMethodIds,
  IntegrationConnectionMethodKinds,
} from "../types/index.js";
import { IntegrationRegistry } from "./index.js";

const ConfigSchema = z.record(z.string(), z.unknown());
const EmptySecretsSchema = z.object({});
const ApiKeyConnectionMethods = [
  {
    id: IntegrationConnectionMethodIds.API_KEY,
    label: "API key",
    kind: IntegrationConnectionMethodKinds.API_KEY,
  },
] as const;
const GitHubAppInstallationConnectionMethods = [
  {
    id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    label: "GitHub App installation",
    kind: IntegrationConnectionMethodKinds.REDIRECT,
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

    try {
      registry.register(definition);
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationDefinitionRegistryError);
      if (error instanceof IntegrationDefinitionRegistryError) {
        expect(error.code).toBe(DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION);
      }
    }
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
});
