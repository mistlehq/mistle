import { createIntegrationRegistry } from "@mistle/integrations-definitions";

const IntegrationRegistry = createIntegrationRegistry();

export type ProjectedTargetHealth = {
  configStatus: "valid" | "invalid";
};

export function projectTargetUi(input: {
  familyId: string;
  variantId: string;
  config: Record<string, unknown>;
}): {
  targetHealth: ProjectedTargetHealth;
} {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
  if (definition === undefined) {
    return {
      targetHealth: {
        configStatus: "valid",
      },
    };
  }

  try {
    definition.targetConfigSchema.parse(input.config);
  } catch {
    return {
      targetHealth: {
        configStatus: "invalid",
      },
    };
  }

  return {
    targetHealth: {
      configStatus: "valid",
    },
  };
}
