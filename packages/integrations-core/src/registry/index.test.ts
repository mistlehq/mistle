import { describe, expect, it } from "vitest";

import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import { IntegrationRegistry } from "./index.js";

describe("integration registry", () => {
  it("registers and resolves definitions by family + variant", () => {
    const registry = new IntegrationRegistry();

    registry.register({
      familyId: "openai",
      variantId: "openai_default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      deploymentConfigSchema: {},
      bindingConfigSchema: {},
      supportedAuthSchemes: ["api-key"],
      triggerEventTypes: [],
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClientSetups: [],
      }),
    });

    const definition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai_default",
    });

    expect(definition?.displayName).toBe("OpenAI");
  });

  it("fails on duplicate family + variant registration", () => {
    const registry = new IntegrationRegistry();
    const definition: IntegrationDefinition = {
      familyId: "openai",
      variantId: "openai_default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      deploymentConfigSchema: {},
      bindingConfigSchema: {},
      supportedAuthSchemes: ["api-key"],
      triggerEventTypes: [],
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
        deploymentConfigSchema: {},
        bindingConfigSchema: {},
        supportedAuthSchemes: ["oauth"],
        triggerEventTypes: ["github.issue_comment.created"],
        compileBinding: () => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClientSetups: [],
        }),
      },
      {
        familyId: "openai",
        variantId: "openai_default",
        kind: "agent",
        displayName: "OpenAI",
        logoKey: "openai",
        deploymentConfigSchema: {},
        bindingConfigSchema: {},
        supportedAuthSchemes: ["api-key"],
        triggerEventTypes: [],
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
});
