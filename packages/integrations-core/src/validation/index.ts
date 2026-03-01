import { routesOverlap } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledRuntimeArtifactSpec,
  CompiledBindingResult,
  EgressCredentialRoute,
  CompiledRuntimeClientSetup,
  EgressUrlRef,
} from "../types/index.js";

function flattenCompiledBindingResults(input: ReadonlyArray<CompiledBindingResult>): {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClientSetups: ReadonlyArray<CompiledRuntimeClientSetup>;
} {
  const egressRoutes: EgressCredentialRoute[] = [];
  const artifacts: CompiledRuntimeArtifactSpec[] = [];
  const runtimeClientSetups: CompiledRuntimeClientSetup[] = [];

  for (const compiledBindingResult of input) {
    egressRoutes.push(...compiledBindingResult.egressRoutes);
    artifacts.push(...compiledBindingResult.artifacts);
    runtimeClientSetups.push(...compiledBindingResult.runtimeClientSetups);
  }

  return {
    egressRoutes,
    artifacts,
    runtimeClientSetups,
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
    if (artifact.lifecycle.onSandboxCreate.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must include at least one onSandboxCreate command.`,
      );
    }

    const lifecycleHooks: ReadonlyArray<ReadonlyArray<{ run: string; timeoutMs?: number }>> = [
      artifact.lifecycle.onSandboxCreate,
      artifact.lifecycle.onSandboxResume ?? [],
      artifact.lifecycle.onSandboxShutdown ?? [],
    ];

    for (const hookCommands of lifecycleHooks) {
      for (const command of hookCommands) {
        if (command.run.trim().length === 0) {
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
  left: ReadonlyArray<{ run: string; timeoutMs?: number }>,
  right: ReadonlyArray<{ run: string; timeoutMs?: number }>,
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

    if (leftCommand.run !== rightCommand.run || leftCommand.timeoutMs !== rightCommand.timeoutMs) {
      return false;
    }
  }

  return true;
}

function artifactLifecycleEquals(
  left: CompiledRuntimeArtifactSpec["lifecycle"],
  right: CompiledRuntimeArtifactSpec["lifecycle"],
): boolean {
  const leftResume = left.onSandboxResume ?? [];
  const rightResume = right.onSandboxResume ?? [];
  const leftShutdown = left.onSandboxShutdown ?? [];
  const rightShutdown = right.onSandboxShutdown ?? [];

  return (
    artifactCommandsEqual(left.onSandboxCreate, right.onSandboxCreate) &&
    artifactCommandsEqual(leftResume, rightResume) &&
    artifactCommandsEqual(leftShutdown, rightShutdown)
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

export function validateCompiledBindingResults(input: {
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
}): void {
  const flattenedResults = flattenCompiledBindingResults(input.compiledBindingResults);

  validateRoutes(flattenedResults.egressRoutes);
  validateArtifacts(flattenedResults.artifacts);
  validateRuntimeClientSetups(flattenedResults.runtimeClientSetups);
}
