import { createIntegrationRegistry } from "@mistle/integrations-definitions";

const IntegrationRegistry = createIntegrationRegistry();

export type ProjectedTargetHealth = {
  configStatus: "valid" | "invalid";
};

export type ProjectedBindingUi = Record<string, unknown>;

export function projectTargetUi(input: {
  familyId: string;
  variantId: string;
  config: Record<string, unknown>;
}): {
  targetHealth: ProjectedTargetHealth;
  resolvedBindingUi?: ProjectedBindingUi;
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
    const parsedTargetConfig = definition.targetConfigSchema.parse(input.config);
    const projectedBindingUi =
      definition.projectTargetUi === undefined
        ? undefined
        : definition.projectTargetUi({
            familyId: input.familyId,
            variantId: input.variantId,
            kind: definition.kind,
            targetConfig: parsedTargetConfig,
          });
    const resolvedBindingUi =
      projectedBindingUi === undefined
        ? undefined
        : definition.targetUiProjectionSchema === undefined
          ? projectedBindingUi
          : definition.targetUiProjectionSchema.parse(projectedBindingUi);

    if (resolvedBindingUi !== undefined) {
      return {
        targetHealth: {
          configStatus: "valid",
        },
        resolvedBindingUi,
      };
    }

    return {
      targetHealth: {
        configStatus: "valid",
      },
    };
  } catch {
    return {
      targetHealth: {
        configStatus: "invalid",
      },
    };
  }
}
