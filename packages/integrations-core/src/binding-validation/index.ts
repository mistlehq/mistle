import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  BindingWriteValidationIssue,
  BindingWriteValidationResult,
  IntegrationConnection,
  IntegrationConfigSchema,
  IntegrationDefinition,
  IntegrationTarget,
} from "../types/index.js";

type BindingConfigObject = {
  [key: string]: unknown;
};

function parseBindingConfigObject(value: unknown): BindingConfigObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record: BindingConfigObject = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }
  return record;
}

function sanitizeSchemaFailureMessage(input: {
  familyId: string;
  variantId: string;
  bindingIdOrDraftIndex: string;
}): string {
  return `Binding '${input.bindingIdOrDraftIndex}' has invalid config reference: Binding config is invalid for integration '${input.familyId}/${input.variantId}'.`;
}

export function runDefinitionBindingWriteValidation(input: {
  definition: IntegrationDefinition<
    IntegrationConfigSchema<unknown>,
    IntegrationConfigSchema<unknown>,
    IntegrationConfigSchema<unknown>,
    IntegrationConfigSchema<Record<string, unknown>> | undefined
  >;
  targetKey: string;
  target: Pick<IntegrationTarget, "familyId" | "variantId" | "config">;
  connection: Pick<IntegrationConnection, "id" | "config">;
  binding: {
    kind: string;
    config: Record<string, unknown>;
  };
  bindingIdOrDraftIndex: string;
}):
  | {
      ok: true;
      parsed: {
        targetConfig: unknown;
        bindingConfig: unknown;
        connectionConfig: Record<string, unknown>;
      };
    }
  | {
      ok: false;
      issues: readonly BindingWriteValidationIssue[];
    } {
  let parsedTargetConfig: Record<string, unknown>;
  try {
    const targetConfigCandidate = input.definition.targetConfigSchema.parse(input.target.config);
    const targetConfigRecord = parseBindingConfigObject(targetConfigCandidate);
    if (targetConfigRecord === null) {
      throw new Error("Target config must be an object.");
    }
    parsedTargetConfig = targetConfigRecord;
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "system.invalid_target_config_shape",
          field: "config",
          safeMessage: sanitizeSchemaFailureMessage({
            familyId: input.target.familyId,
            variantId: input.target.variantId,
            bindingIdOrDraftIndex: input.bindingIdOrDraftIndex,
          }),
        },
      ],
    };
  }

  let parsedBindingConfig: Record<string, unknown>;
  try {
    const bindingConfigCandidate = input.definition.bindingConfigSchema.parse(input.binding.config);
    const bindingConfigRecord = parseBindingConfigObject(bindingConfigCandidate);
    if (bindingConfigRecord === null) {
      throw new Error("Binding config must be an object.");
    }
    parsedBindingConfig = bindingConfigRecord;
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "system.invalid_binding_config_shape",
          field: "config",
          safeMessage: sanitizeSchemaFailureMessage({
            familyId: input.target.familyId,
            variantId: input.target.variantId,
            bindingIdOrDraftIndex: input.bindingIdOrDraftIndex,
          }),
        },
      ],
    };
  }

  let parsedConnectionConfig: Record<string, unknown>;
  try {
    const connectionConfigCandidate = input.definition.connectionConfigSchema
      ? input.definition.connectionConfigSchema.parse(input.connection.config)
      : input.connection.config;
    const connectionConfigRecord = parseBindingConfigObject(connectionConfigCandidate);
    if (connectionConfigRecord === null) {
      throw new Error("Connection config must be an object.");
    }
    parsedConnectionConfig = connectionConfigRecord;
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "system.invalid_connection_config_shape",
          field: "connection.config",
          safeMessage: sanitizeSchemaFailureMessage({
            familyId: input.target.familyId,
            variantId: input.target.variantId,
            bindingIdOrDraftIndex: input.bindingIdOrDraftIndex,
          }),
        },
      ],
    };
  }

  if (input.definition.validateBindingWriteContext === undefined) {
    return {
      ok: true,
      parsed: {
        targetConfig: parsedTargetConfig,
        bindingConfig: parsedBindingConfig,
        connectionConfig: parsedConnectionConfig,
      },
    };
  }

  let validationResult: BindingWriteValidationResult;
  try {
    validationResult = input.definition.validateBindingWriteContext({
      targetKey: input.targetKey,
      bindingIdOrDraftIndex: input.bindingIdOrDraftIndex,
      target: {
        familyId: input.target.familyId,
        variantId: input.target.variantId,
        config: parsedTargetConfig,
      },
      connection: {
        id: input.connection.id,
        config: parsedConnectionConfig,
      },
      binding: {
        kind: input.binding.kind,
        config: parsedBindingConfig,
      },
    });
  } catch (error) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.INVALID_BINDING_CONFIG,
      `Binding '${input.bindingIdOrDraftIndex}' contextual validation failed unexpectedly.`,
      { cause: error },
    );
  }

  if (!validationResult.ok) {
    return validationResult;
  }

  return {
    ok: true,
    parsed: {
      targetConfig: parsedTargetConfig,
      bindingConfig: parsedBindingConfig,
      connectionConfig: parsedConnectionConfig,
    },
  };
}
