import { createIntegrationRegistry } from "@mistle/integrations-definitions";

const IntegrationRegistry = createIntegrationRegistry();

export type ProjectedTargetHealth = {
  configStatus: "valid" | "invalid";
  reason?: "invalid-config" | "invalid-projection";
};

export type ProjectedBindingEditorUi = Record<string, unknown>;

export function projectTargetUi(input: {
  familyId: string;
  variantId: string;
  config: Record<string, unknown>;
}): {
  targetHealth: ProjectedTargetHealth;
  resolvedBindingEditorUi?: ProjectedBindingEditorUi;
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

  let parsedTargetConfig: Record<string, unknown>;
  try {
    parsedTargetConfig = definition.targetConfigSchema.parse(input.config);
  } catch {
    return {
      targetHealth: {
        configStatus: "invalid",
        reason: "invalid-config",
      },
    };
  }

  try {
    const projectedBindingEditorUi =
      definition.projectBindingEditorUi === undefined
        ? undefined
        : definition.projectBindingEditorUi({
            familyId: input.familyId,
            variantId: input.variantId,
            kind: definition.kind,
            targetConfig: parsedTargetConfig,
          });
    const resolvedBindingEditorUi =
      projectedBindingEditorUi === undefined
        ? undefined
        : definition.bindingEditorUiProjectionSchema === undefined
          ? projectedBindingEditorUi
          : definition.bindingEditorUiProjectionSchema.parse(projectedBindingEditorUi);

    if (resolvedBindingEditorUi !== undefined) {
      return {
        targetHealth: {
          configStatus: "valid",
        },
        ...(resolvedBindingEditorUi === undefined ? {} : { resolvedBindingEditorUi }),
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
        reason: "invalid-projection",
      },
    };
  }
}
