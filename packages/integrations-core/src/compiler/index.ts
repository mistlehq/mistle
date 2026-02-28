import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan } from "../runtime-plan/index.js";
import {
  egressUrlRef,
  IntegrationConnectionStatuses,
  type CompileBindingResult,
  type CompileRuntimePlanInput,
  type CompiledBindingResult,
  type CompiledRuntimePlan,
} from "../types/index.js";
import { validateCompiledBindingResults } from "../validation/index.js";

function resolveRouteId(input: { bindingId: string; routeIndex: number }): string {
  if (input.routeIndex === 0) {
    return `route_${input.bindingId}`;
  }

  return `route_${input.bindingId}_${input.routeIndex + 1}`;
}

export function compileRuntimePlan(input: CompileRuntimePlanInput): CompiledRuntimePlan {
  const compiledBindingResults: CompiledBindingResult[] = [];

  for (const bindingInput of input.bindings) {
    if (bindingInput.connection.id !== bindingInput.binding.connectionId) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.CONNECTION_MISMATCH,
        `Binding '${bindingInput.binding.id}' references connection '${bindingInput.binding.connectionId}' but resolved connection was '${bindingInput.connection.id}'.`,
      );
    }

    if (!bindingInput.target.enabled) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.TARGET_DISABLED,
        `Target '${bindingInput.targetKey}' is disabled.`,
      );
    }

    if (bindingInput.connection.status !== IntegrationConnectionStatuses.ACTIVE) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.CONNECTION_NOT_ACTIVE,
        `Connection '${bindingInput.connection.id}' is not active.`,
      );
    }

    const definition = input.registry.getDefinitionOrThrow({
      familyId: bindingInput.target.familyId,
      variantId: bindingInput.target.variantId,
    });

    if (definition.kind !== bindingInput.binding.kind) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.KIND_MISMATCH,
        `Binding '${bindingInput.binding.id}' has kind '${bindingInput.binding.kind}' but definition '${definition.familyId}::${definition.variantId}' has kind '${definition.kind}'.`,
      );
    }

    let parsedTargetConfig: ReturnType<typeof definition.targetConfigSchema.parse>;
    try {
      parsedTargetConfig = definition.targetConfigSchema.parse(bindingInput.target.config);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.INVALID_TARGET_CONFIG,
        `Target config for '${bindingInput.targetKey}' did not satisfy '${definition.familyId}::${definition.variantId}' schema.`,
        { cause: error },
      );
    }

    let parsedBindingConfig: ReturnType<typeof definition.bindingConfigSchema.parse>;
    try {
      parsedBindingConfig = definition.bindingConfigSchema.parse(bindingInput.binding.config);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.INVALID_BINDING_CONFIG,
        `Binding config for '${bindingInput.binding.id}' did not satisfy '${definition.familyId}::${definition.variantId}' schema.`,
        { cause: error },
      );
    }

    const compileBindingResult: CompileBindingResult = definition.compileBinding({
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: bindingInput.targetKey,
      target: {
        ...bindingInput.target,
        config: parsedTargetConfig,
      },
      connection: bindingInput.connection,
      binding: {
        id: bindingInput.binding.id,
        kind: bindingInput.binding.kind,
        config: parsedBindingConfig,
      },
      refs: {
        egressUrl: egressUrlRef(`route_${bindingInput.binding.id}`),
      },
      runtimeContext: input.runtimeContext,
    });

    const compiledBindingResult: CompiledBindingResult = {
      egressRoutes: compileBindingResult.egressRoutes.map((route, routeIndex) => ({
        ...route,
        routeId: resolveRouteId({
          bindingId: bindingInput.binding.id,
          routeIndex,
        }),
        bindingId: bindingInput.binding.id,
      })),
      artifacts: compileBindingResult.artifacts,
      runtimeClientSetups: compileBindingResult.runtimeClientSetups,
    };

    compiledBindingResults.push(compiledBindingResult);
  }

  validateCompiledBindingResults({
    compiledBindingResults,
  });

  return assembleCompiledRuntimePlan({
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: input.image,
    runtimeContext: input.runtimeContext,
    compiledBindingResults,
  });
}
