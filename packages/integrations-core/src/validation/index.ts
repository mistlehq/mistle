import { routesOverlap } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledRuntimeArtifactSpec,
  CompiledBindingResult,
  EgressCredentialRoute,
  CompiledRuntimeClientSetup,
  EgressUrlRef,
  RuntimeClientProcessSpec,
} from "../types/index.js";

function flattenCompiledBindingResults(input: ReadonlyArray<CompiledBindingResult>): {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClientSetups: ReadonlyArray<CompiledRuntimeClientSetup>;
  runtimeClientProcesses: ReadonlyArray<RuntimeClientProcessSpec>;
} {
  const egressRoutes: EgressCredentialRoute[] = [];
  const artifacts: CompiledRuntimeArtifactSpec[] = [];
  const runtimeClientSetups: CompiledRuntimeClientSetup[] = [];
  const runtimeClientProcesses: RuntimeClientProcessSpec[] = [];

  for (const compiledBindingResult of input) {
    egressRoutes.push(...compiledBindingResult.egressRoutes);
    artifacts.push(...compiledBindingResult.artifacts);
    runtimeClientSetups.push(...compiledBindingResult.runtimeClientSetups);
    runtimeClientProcesses.push(...compiledBindingResult.runtimeClientProcesses);
  }

  return {
    egressRoutes,
    artifacts,
    runtimeClientSetups,
    runtimeClientProcesses,
  };
}

function validateRoutes(input: ReadonlyArray<EgressCredentialRoute>): void {
  const routeIdToRoute = new Map<string, EgressCredentialRoute>();

  for (const route of input) {
    const existingRoute = routeIdToRoute.get(route.routeId);
    if (existingRoute !== undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ROUTE_CONFLICT,
        `Duplicate egress route id '${route.routeId}' detected for bindings '${existingRoute.bindingId}' and '${route.bindingId}'.`,
      );
    }

    routeIdToRoute.set(route.routeId, route);
  }

  for (let leftIndex = 0; leftIndex < input.length; leftIndex += 1) {
    const leftRoute = input[leftIndex];
    if (leftRoute === undefined) {
      throw new Error("Expected left route to be present.");
    }

    for (let rightIndex = leftIndex + 1; rightIndex < input.length; rightIndex += 1) {
      const rightRoute = input[rightIndex];
      if (rightRoute === undefined) {
        throw new Error("Expected right route to be present.");
      }

      if (
        routesOverlap({
          left: leftRoute,
          right: rightRoute,
        })
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.ROUTE_CONFLICT,
          `Overlapping egress routes detected: '${leftRoute.routeId}' and '${rightRoute.routeId}'.`,
        );
      }
    }
  }
}

function validateArtifacts(input: ReadonlyArray<CompiledRuntimeArtifactSpec>): void {
  const artifactByKey = new Map<string, CompiledRuntimeArtifactSpec>();

  for (const artifact of input) {
    if (artifact.lifecycle.install.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must include at least one install command.`,
      );
    }
    if (artifact.lifecycle.remove.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must include at least one remove command.`,
      );
    }

    const lifecycleHooks: ReadonlyArray<
      ReadonlyArray<CompiledRuntimeArtifactSpec["lifecycle"]["install"][number]>
    > = [artifact.lifecycle.install, artifact.lifecycle.update ?? [], artifact.lifecycle.remove];

    for (const hookCommands of lifecycleHooks) {
      for (const command of hookCommands) {
        if (command.args.length === 0) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.ARTIFACT_CONFLICT,
            `Artifact '${artifact.artifactKey}' contains a lifecycle command with no args.`,
          );
        }

        const commandName = command.args[0];
        if (commandName === undefined || commandName.trim().length === 0) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.ARTIFACT_CONFLICT,
            `Artifact '${artifact.artifactKey}' contains an empty lifecycle command.`,
          );
        }
      }
    }

    const existingArtifact = artifactByKey.get(artifact.artifactKey);
    if (existingArtifact === undefined) {
      artifactByKey.set(artifact.artifactKey, artifact);
      continue;
    }

    const hasEquivalentSpec =
      existingArtifact.name === artifact.name &&
      existingArtifact.description === artifact.description &&
      artifactLifecycleEquals(existingArtifact.lifecycle, artifact.lifecycle);

    if (!hasEquivalentSpec) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact key conflict detected for '${artifact.artifactKey}'.`,
      );
    }
  }
}

function artifactCommandsEqual(
  left: ReadonlyArray<CompiledRuntimeArtifactSpec["lifecycle"]["install"][number]>,
  right: ReadonlyArray<CompiledRuntimeArtifactSpec["lifecycle"]["install"][number]>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftCommand = left[index];
    const rightCommand = right[index];

    if (leftCommand === undefined || rightCommand === undefined) {
      return false;
    }

    if (
      !stringArrayEquals(leftCommand.args, rightCommand.args) ||
      !stringRecordEquals(leftCommand.env, rightCommand.env) ||
      leftCommand.cwd !== rightCommand.cwd ||
      leftCommand.timeoutMs !== rightCommand.timeoutMs
    ) {
      return false;
    }
  }

  return true;
}

function stringArrayEquals(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue === undefined || rightValue === undefined || leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}

function stringRecordEquals(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }

  return true;
}

function artifactLifecycleEquals(
  left: CompiledRuntimeArtifactSpec["lifecycle"],
  right: CompiledRuntimeArtifactSpec["lifecycle"],
): boolean {
  const leftUpdate = left.update ?? [];
  const rightUpdate = right.update ?? [];

  return (
    artifactCommandsEqual(left.install, right.install) &&
    artifactCommandsEqual(leftUpdate, rightUpdate) &&
    artifactCommandsEqual(left.remove, right.remove)
  );
}

function runtimeClientSetupValueEquals(left: string | EgressUrlRef, right: string | EgressUrlRef) {
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }

  return left.kind === right.kind && left.routeId === right.routeId;
}

function validateRuntimeClientSetups(input: ReadonlyArray<CompiledRuntimeClientSetup>): void {
  const clientEnvByClientId = new Map<string, Map<string, string | EgressUrlRef>>();
  const clientFilesByPathByClientId = new Map<
    string,
    Map<string, { fileId: string; mode: number; content: string }>
  >();
  const clientFilesByIdByClientId = new Map<
    string,
    Map<string, { path: string; mode: number; content: string }>
  >();

  for (const runtimeClientSetup of input) {
    let envByKey = clientEnvByClientId.get(runtimeClientSetup.clientId);
    if (envByKey === undefined) {
      envByKey = new Map();
      clientEnvByClientId.set(runtimeClientSetup.clientId, envByKey);
    }

    for (const [envKey, envValue] of Object.entries(runtimeClientSetup.env)) {
      const existingValue = envByKey.get(envKey);
      if (existingValue !== undefined && !runtimeClientSetupValueEquals(existingValue, envValue)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client env conflict for client '${runtimeClientSetup.clientId}' and key '${envKey}'.`,
        );
      }

      envByKey.set(envKey, envValue);
    }

    let filesByPath = clientFilesByPathByClientId.get(runtimeClientSetup.clientId);
    if (filesByPath === undefined) {
      filesByPath = new Map();
      clientFilesByPathByClientId.set(runtimeClientSetup.clientId, filesByPath);
    }

    let filesById = clientFilesByIdByClientId.get(runtimeClientSetup.clientId);
    if (filesById === undefined) {
      filesById = new Map();
      clientFilesByIdByClientId.set(runtimeClientSetup.clientId, filesById);
    }

    for (const file of runtimeClientSetup.files) {
      const existingFileByPath = filesByPath.get(file.path);
      if (
        existingFileByPath !== undefined &&
        (existingFileByPath.fileId !== file.fileId ||
          existingFileByPath.mode !== file.mode ||
          existingFileByPath.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClientSetup.clientId}' and path '${file.path}'.`,
        );
      }

      const existingFileById = filesById.get(file.fileId);
      if (
        existingFileById !== undefined &&
        (existingFileById.path !== file.path ||
          existingFileById.mode !== file.mode ||
          existingFileById.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClientSetup.clientId}' and fileId '${file.fileId}'.`,
        );
      }

      filesByPath.set(file.path, {
        fileId: file.fileId,
        mode: file.mode,
        content: file.content,
      });
      filesById.set(file.fileId, {
        path: file.path,
        mode: file.mode,
        content: file.content,
      });
    }
  }
}

function runtimeArtifactCommandEquals(
  left: RuntimeClientProcessSpec["command"],
  right: RuntimeClientProcessSpec["command"],
): boolean {
  return (
    stringArrayEquals(left.args, right.args) &&
    stringRecordEquals(left.env, right.env) &&
    left.cwd === right.cwd &&
    left.timeoutMs === right.timeoutMs
  );
}

function runtimeClientProcessReadinessEquals(
  left: RuntimeClientProcessSpec["readiness"],
  right: RuntimeClientProcessSpec["readiness"],
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "none" && right.type === "none") {
    return true;
  }

  if (left.type === "tcp" && right.type === "tcp") {
    return (
      left.host === right.host && left.port === right.port && left.timeoutMs === right.timeoutMs
    );
  }

  if (left.type === "http" && right.type === "http") {
    return (
      left.url === right.url &&
      left.expectedStatus === right.expectedStatus &&
      left.timeoutMs === right.timeoutMs
    );
  }

  return false;
}

function runtimeClientProcessStopPolicyEquals(
  left: RuntimeClientProcessSpec["stop"],
  right: RuntimeClientProcessSpec["stop"],
): boolean {
  return (
    left.signal === right.signal &&
    left.timeoutMs === right.timeoutMs &&
    left.gracePeriodMs === right.gracePeriodMs
  );
}

function runtimeClientProcessSpecEquals(
  left: RuntimeClientProcessSpec,
  right: RuntimeClientProcessSpec,
): boolean {
  return (
    left.clientId === right.clientId &&
    runtimeArtifactCommandEquals(left.command, right.command) &&
    runtimeClientProcessReadinessEquals(left.readiness, right.readiness) &&
    runtimeClientProcessStopPolicyEquals(left.stop, right.stop)
  );
}

function validateRuntimeClientProcesses(input: ReadonlyArray<RuntimeClientProcessSpec>): void {
  const processByKey = new Map<string, RuntimeClientProcessSpec>();

  for (const runtimeClientProcess of input) {
    if (runtimeClientProcess.processKey.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        "Runtime client process must define a non-empty processKey.",
      );
    }
    if (runtimeClientProcess.clientId.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' must define a non-empty clientId.`,
      );
    }

    const commandArgs = runtimeClientProcess.command.args;
    if (commandArgs.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' must define at least one command arg.`,
      );
    }
    const commandName = commandArgs[0];
    if (commandName === undefined || commandName.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' has an empty command name.`,
      );
    }

    const commandTimeoutMs = runtimeClientProcess.command.timeoutMs;
    if (commandTimeoutMs !== undefined && commandTimeoutMs <= 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' command timeoutMs must be greater than zero when provided.`,
      );
    }

    if (runtimeClientProcess.readiness.type === "tcp") {
      if (runtimeClientProcess.readiness.host.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process '${runtimeClientProcess.processKey}' tcp readiness host must be non-empty.`,
        );
      }
      if (
        !Number.isInteger(runtimeClientProcess.readiness.port) ||
        runtimeClientProcess.readiness.port < 1 ||
        runtimeClientProcess.readiness.port > 65_535
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process '${runtimeClientProcess.processKey}' tcp readiness port must be an integer between 1 and 65535.`,
        );
      }
      if (runtimeClientProcess.readiness.timeoutMs <= 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process '${runtimeClientProcess.processKey}' tcp readiness timeoutMs must be greater than zero.`,
        );
      }
    }

    if (runtimeClientProcess.readiness.type === "http") {
      try {
        new URL(runtimeClientProcess.readiness.url);
      } catch (error) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process '${runtimeClientProcess.processKey}' http readiness url must be a valid URL.`,
          { cause: error },
        );
      }

      if (
        !Number.isInteger(runtimeClientProcess.readiness.expectedStatus) ||
        runtimeClientProcess.readiness.expectedStatus < 100 ||
        runtimeClientProcess.readiness.expectedStatus > 599
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process '${runtimeClientProcess.processKey}' http readiness expectedStatus must be an integer between 100 and 599.`,
        );
      }

      if (runtimeClientProcess.readiness.timeoutMs <= 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process '${runtimeClientProcess.processKey}' http readiness timeoutMs must be greater than zero.`,
        );
      }
    }

    if (runtimeClientProcess.stop.timeoutMs <= 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' stop timeoutMs must be greater than zero.`,
      );
    }

    if (
      runtimeClientProcess.stop.gracePeriodMs !== undefined &&
      runtimeClientProcess.stop.gracePeriodMs < 0
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' stop gracePeriodMs must be greater than or equal to zero when provided.`,
      );
    }

    const existingProcess = processByKey.get(runtimeClientProcess.processKey);
    if (existingProcess === undefined) {
      processByKey.set(runtimeClientProcess.processKey, runtimeClientProcess);
      continue;
    }

    if (!runtimeClientProcessSpecEquals(existingProcess, runtimeClientProcess)) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process key conflict for '${runtimeClientProcess.processKey}'.`,
      );
    }
  }
}

export function validateCompiledBindingResults(input: {
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
}): void {
  const flattenedResults = flattenCompiledBindingResults(input.compiledBindingResults);

  validateRoutes(flattenedResults.egressRoutes);
  validateArtifacts(flattenedResults.artifacts);
  validateRuntimeClientSetups(flattenedResults.runtimeClientSetups);
  validateRuntimeClientProcesses(flattenedResults.runtimeClientProcesses);
}
