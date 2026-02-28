import { routesOverlap } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledBindingResult,
  EgressCredentialRoute,
  RuntimeArtifactSpec,
  RuntimeClientSetup,
} from "../types/index.js";

function flattenCompiledBindingResults(input: ReadonlyArray<CompiledBindingResult>): {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  runtimeClientSetups: ReadonlyArray<RuntimeClientSetup>;
} {
  const egressRoutes: EgressCredentialRoute[] = [];
  const artifacts: RuntimeArtifactSpec[] = [];
  const runtimeClientSetups: RuntimeClientSetup[] = [];

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

function validateArtifacts(input: ReadonlyArray<RuntimeArtifactSpec>): void {
  const installPathToArtifact = new Map<string, RuntimeArtifactSpec>();

  for (const artifact of input) {
    const existingArtifact = installPathToArtifact.get(artifact.installPath);

    if (existingArtifact === undefined) {
      installPathToArtifact.set(artifact.installPath, artifact);
      continue;
    }

    const hasEquivalentSpec =
      existingArtifact.artifactId === artifact.artifactId &&
      existingArtifact.uri === artifact.uri &&
      existingArtifact.sha256 === artifact.sha256 &&
      existingArtifact.executable === artifact.executable;

    if (!hasEquivalentSpec) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact install path conflict detected at '${artifact.installPath}'.`,
      );
    }
  }
}

function validateRuntimeClientSetups(input: ReadonlyArray<RuntimeClientSetup>): void {
  const clientEnvByClientId = new Map<string, Map<string, string>>();
  const clientFilesByClientId = new Map<string, Map<string, { mode: number; content: string }>>();

  for (const runtimeClientSetup of input) {
    let envByKey = clientEnvByClientId.get(runtimeClientSetup.clientId);
    if (envByKey === undefined) {
      envByKey = new Map();
      clientEnvByClientId.set(runtimeClientSetup.clientId, envByKey);
    }

    for (const [envKey, envValue] of Object.entries(runtimeClientSetup.env)) {
      const existingValue = envByKey.get(envKey);
      if (existingValue !== undefined && existingValue !== envValue) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client env conflict for client '${runtimeClientSetup.clientId}' and key '${envKey}'.`,
        );
      }

      envByKey.set(envKey, envValue);
    }

    let filesByPath = clientFilesByClientId.get(runtimeClientSetup.clientId);
    if (filesByPath === undefined) {
      filesByPath = new Map();
      clientFilesByClientId.set(runtimeClientSetup.clientId, filesByPath);
    }

    for (const file of runtimeClientSetup.files) {
      const existingFile = filesByPath.get(file.path);
      if (
        existingFile !== undefined &&
        (existingFile.mode !== file.mode || existingFile.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClientSetup.clientId}' and path '${file.path}'.`,
        );
      }

      filesByPath.set(file.path, {
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
