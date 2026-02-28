import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import { IntegrationRegistry } from "./index.js";

const ConfigSchema = z.record(z.string(), z.unknown());

describe("integration registry", () => {
  it("registers and resolves definitions by family + variant", () => {
    const registry = new IntegrationRegistry();

    registry.register({
      familyId: "openai",
      variantId: "openai-api-key",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: ConfigSchema,
      bindingConfigSchema: ConfigSchema,
      supportedAuthSchemes: ["api-key"],
      triggerEventTypes: [],
      userConfigSlots: [],
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClientSetups: [],
      }),
    });

    const definition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai-api-key",
    });

    expect(definition?.displayName).toBe("OpenAI");
  });

  it("fails on duplicate family + variant registration", () => {
    const registry = new IntegrationRegistry();
    const definition: IntegrationDefinition = {
      familyId: "openai",
      variantId: "openai-api-key",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: ConfigSchema,
      bindingConfigSchema: ConfigSchema,
      supportedAuthSchemes: ["api-key"],
      triggerEventTypes: [],
      userConfigSlots: [],
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClientSetups: [],
      }),
    };

    registry.register(definition);

    expect(() => registry.register(definition)).toThrowError(IntegrationDefinitionRegistryError);

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
        bindingConfigSchema: ConfigSchema,
        supportedAuthSchemes: ["oauth"],
        triggerEventTypes: ["github.issue_comment.created"],
        userConfigSlots: [],
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClientSetups: [],
        }),
      },
      {
        familyId: "openai",
        variantId: "openai-api-key",
        kind: "agent",
        displayName: "OpenAI",
        logoKey: "openai",
        targetConfigSchema: ConfigSchema,
        bindingConfigSchema: ConfigSchema,
        supportedAuthSchemes: ["api-key"],
        triggerEventTypes: [],
        userConfigSlots: [],
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClientSetups: [],
        }),
      },
    ]);

    const listedDefinitions = registry.listDefinitions();

    expect(listedDefinitions.map((definition) => definition.familyId)).toEqual([
      "github",
      "openai",
    ]);
  });

  it("fails when user config slots have duplicate keys", () => {
    const registry = new IntegrationRegistry();

    expect(() =>
      registry.register({
        familyId: "openai",
        variantId: "openai-api-key",
        kind: "agent",
        displayName: "OpenAI",
        logoKey: "openai",
        targetConfigSchema: ConfigSchema,
        bindingConfigSchema: ConfigSchema,
        supportedAuthSchemes: ["api-key"],
        triggerEventTypes: [],
        userConfigSlots: [
          {
            kind: "env",
            key: "model",
            label: "Model",
            valueSchema: {
              parse: (input: unknown) => z.string().min(1).parse(input),
            },
            applyTo: {
              clientId: "codex-cli",
              envKey: "OPENAI_MODEL",
            },
          },
          {
            kind: "env",
            key: "model",
            label: "Model override",
            valueSchema: {
              parse: (input: unknown) => z.string().min(1).parse(input),
            },
            applyTo: {
              clientId: "codex-cli",
              envKey: "OPENAI_MODEL",
            },
          },
        ],
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClientSetups: [],
        }),
      }),
    ).toThrowError(IntegrationDefinitionRegistryError);
  });
});
