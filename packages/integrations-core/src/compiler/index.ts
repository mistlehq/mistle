import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan } from "../runtime-plan/index.js";
import {
  egressUrlRef,
  IntegrationConnectionStatuses,
  type CompileBindingResult,
  type CompileRuntimePlanInput,
  type CompiledBindingResult,
  type CompiledRuntimeArtifactSpec,
  type CompiledRuntimePlan,
  type RuntimeArtifactCommand,
  type RuntimeArtifactLifecycleBuilder,
  type RuntimeArtifactRefs,
  type RuntimeArtifactSpec,
} from "../types/index.js";
import { validateCompiledBindingResults } from "../validation/index.js";

function resolveRouteId(input: { bindingId: string; routeIndex: number }): string {
  if (input.routeIndex === 0) {
    return `route_${input.bindingId}`;
  }

  return `route_${input.bindingId}_${input.routeIndex + 1}`;
}

function escapeShellArg(input: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(input)) {
    return input;
  }

  if (input.length === 0) {
    return "''";
  }

  return `'${input.replaceAll("'", "'\"'\"'")}'`;
}

function toShellCommand(args: ReadonlyArray<string>): string {
  return args.map((arg) => escapeShellArg(arg)).join(" ");
}

function createRuntimeArtifactRefs(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  bindingId: string;
  sandboxProvider: string;
}): RuntimeArtifactRefs {
  const exec = (execInput: {
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }): RuntimeArtifactCommand => {
    const envPrefix =
      execInput.env === undefined
        ? ""
        : `${Object.entries(execInput.env)
            .map(([key, value]) => `${key}=${escapeShellArg(value)}`)
            .join(" ")} `;
    const cwdPrefix = execInput.cwd === undefined ? "" : `cd ${escapeShellArg(execInput.cwd)} && `;

    return {
      run: `${envPrefix}${cwdPrefix}${toShellCommand(execInput.args)}`,
      ...(execInput.timeoutMs === undefined ? {} : { timeoutMs: execInput.timeoutMs }),
    };
  };

  return {
    command: {
      exec,
    },
    mise: {
      install: (installInput) =>
        exec({
          args: [
            "mise",
            "install",
            ...(installInput.force === true ? ["--force"] : []),
            ...installInput.tools,
          ],
          ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
        }),
    },
    compileContext: {
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: input.targetKey,
      bindingId: input.bindingId,
      sandboxProvider: input.sandboxProvider,
    },
  };
}

type RuntimeArtifactLifecycleHook =
  | ReadonlyArray<RuntimeArtifactCommand>
  | RuntimeArtifactLifecycleBuilder;

function resolveLifecycleHook(input: {
  artifactKey: string;
  hookName: "onSandboxCreate" | "onSandboxResume" | "onSandboxShutdown";
  hook: RuntimeArtifactLifecycleHook | undefined;
  refs: RuntimeArtifactRefs;
}): ReadonlyArray<RuntimeArtifactCommand> | undefined {
  if (input.hook === undefined) {
    return undefined;
  }

  try {
    if (typeof input.hook === "function") {
      return input.hook({ refs: input.refs });
    }

    return input.hook;
  } catch (error) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.ARTIFACT_CONFLICT,
      `Failed resolving artifact lifecycle hook '${input.hookName}' for '${input.artifactKey}'.`,
      { cause: error },
    );
  }
}

function resolveRuntimeArtifacts(input: {
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  bindingId: string;
  sandboxProvider: string;
}): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  const refs = createRuntimeArtifactRefs({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    targetKey: input.targetKey,
    bindingId: input.bindingId,
    sandboxProvider: input.sandboxProvider,
  });

  return input.artifacts.map((artifact) => {
    const onSandboxCreate = resolveLifecycleHook({
      artifactKey: artifact.artifactKey,
      hookName: "onSandboxCreate",
      hook: artifact.lifecycle.onSandboxCreate,
      refs,
    });

    if (onSandboxCreate === undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must define onSandboxCreate commands.`,
      );
    }

    const onSandboxResume = resolveLifecycleHook({
      artifactKey: artifact.artifactKey,
      hookName: "onSandboxResume",
      hook: artifact.lifecycle.onSandboxResume,
      refs,
    });
    const onSandboxShutdown = resolveLifecycleHook({
      artifactKey: artifact.artifactKey,
      hookName: "onSandboxShutdown",
      hook: artifact.lifecycle.onSandboxShutdown,
      refs,
    });

    return {
      artifactKey: artifact.artifactKey,
      name: artifact.name,
      ...(artifact.description === undefined ? {} : { description: artifact.description }),
      lifecycle: {
        onSandboxCreate,
        ...(onSandboxResume === undefined ? {} : { onSandboxResume }),
        ...(onSandboxShutdown === undefined ? {} : { onSandboxShutdown }),
      },
    };
  });
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
      artifacts: resolveRuntimeArtifacts({
        artifacts: compileBindingResult.artifacts,
        organizationId: input.organizationId,
        sandboxProfileId: input.sandboxProfileId,
        version: input.version,
        targetKey: bindingInput.targetKey,
        bindingId: bindingInput.binding.id,
        sandboxProvider: input.runtimeContext.sandboxProvider,
      }),
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
