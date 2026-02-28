import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan } from "../runtime-plan/index.js";
import {
  IntegrationConnectionStatuses,
  type CompileRuntimePlanInput,
  type CompiledBindingResult,
  type CompiledRuntimePlan,
} from "../types/index.js";
import { validateCompiledBindingResults } from "../validation/index.js";

export function compileRuntimePlan(input: CompileRuntimePlanInput): CompiledRuntimePlan {
  const compiledBindingResults: CompiledBindingResult[] = [];

  for (const bindingInput of input.bindings) {
    if (bindingInput.connection.id !== bindingInput.binding.connectionId) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.CONNECTION_MISMATCH,
        `Binding '${bindingInput.binding.id}' references connection '${bindingInput.binding.connectionId}' but resolved connection was '${bindingInput.connection.id}'.`,
      );
    }

    if (!bindingInput.deployment.enabled) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.DEPLOYMENT_DISABLED,
        `Deployment '${bindingInput.deploymentKey}' is disabled.`,
      );
    }

    if (bindingInput.connection.status !== IntegrationConnectionStatuses.ACTIVE) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.CONNECTION_NOT_ACTIVE,
        `Connection '${bindingInput.connection.id}' is not active.`,
      );
    }

    const definition = input.registry.getDefinitionOrThrow({
      familyId: bindingInput.deployment.familyId,
      variantId: bindingInput.deployment.variantId,
    });

    if (definition.kind !== bindingInput.binding.kind) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.KIND_MISMATCH,
        `Binding '${bindingInput.binding.id}' has kind '${bindingInput.binding.kind}' but definition '${definition.familyId}::${definition.variantId}' has kind '${definition.kind}'.`,
      );
    }

    let parsedDeploymentConfig: ReturnType<typeof definition.deploymentConfigSchema.parse>;
    try {
      parsedDeploymentConfig = definition.deploymentConfigSchema.parse(
        bindingInput.deployment.config,
      );
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.INVALID_DEPLOYMENT_CONFIG,
        `Deployment config for '${bindingInput.deploymentKey}' did not satisfy '${definition.familyId}::${definition.variantId}' schema.`,
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

    const compiledBindingResult = definition.compileBinding({
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      deploymentKey: bindingInput.deploymentKey,
      deployment: {
        ...bindingInput.deployment,
        config: parsedDeploymentConfig,
      },
      connection: bindingInput.connection,
      binding: {
        id: bindingInput.binding.id,
        kind: bindingInput.binding.kind,
        config: parsedBindingConfig,
      },
      runtimeContext: input.runtimeContext,
    });

    compiledBindingResults.push(compiledBindingResult);
  }

  validateCompiledBindingResults({
    compiledBindingResults,
  });

  return assembleCompiledRuntimePlan({
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: input.image,
    compiledBindingResults,
  });
}
