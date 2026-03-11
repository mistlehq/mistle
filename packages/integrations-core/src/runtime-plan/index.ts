import { orderRoutesForMatching } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledAgentRuntime,
  CompiledBindingResult,
  CompiledRuntimeArtifactSpec,
  CompiledRuntimeArtifactRemovalSpec,
  CompiledRuntimeClient,
  CompiledRuntimePlan,
  CompiledWorkspaceSource,
  RuntimeArtifactCommand,
  RuntimeClient,
  RuntimeClientEndpointSpec,
  RuntimeClientProcessSpec,
} from "../types/index.js";

export { CompiledRuntimePlanSchema } from "./schema.js";

type AssembleCompiledRuntimePlanInput = {
  sandboxProfileId: string;
  version: number;
  image: CompiledRuntimePlan["image"];
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
  previousCompiledBindingResults?: ReadonlyArray<CompiledBindingResult>;
};

function flattenArtifacts(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  const artifacts: CompiledRuntimeArtifactSpec[] = [];

  for (const compiledBindingResult of input) {
    artifacts.push(...compiledBindingResult.artifacts);
  }

  return artifacts;
}

function flattenRuntimeClients(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<CompiledRuntimeClient> {
  const runtimeClients: CompiledRuntimeClient[] = [];

  for (const compiledBindingResult of input) {
    runtimeClients.push(...compiledBindingResult.runtimeClients);
  }

  return runtimeClients;
}

function flattenAgentRuntimes(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<CompiledAgentRuntime> {
  const agentRuntimes: CompiledAgentRuntime[] = [];

  for (const compiledBindingResult of input) {
    agentRuntimes.push(...compiledBindingResult.agentRuntimes);
  }

  return agentRuntimes;
}

function flattenWorkspaceSources(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<CompiledWorkspaceSource> {
  const workspaceSources: CompiledWorkspaceSource[] = [];

  for (const compiledBindingResult of input) {
    workspaceSources.push(...compiledBindingResult.workspaceSources);
  }

  return workspaceSources;
}

function resolveRuntimeClients(input: {
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
}): ReadonlyArray<RuntimeClient> {
  const resolvedClients: RuntimeClient[] = [];

  for (const runtimeClient of input.runtimeClients) {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(runtimeClient.setup.env)) {
      env[key] = value;
    }

    resolvedClients.push({
      clientId: runtimeClient.clientId,
      setup: {
        env,
        files: runtimeClient.setup.files,
        ...(runtimeClient.setup.launchArgs === undefined
          ? {}
          : { launchArgs: runtimeClient.setup.launchArgs }),
      },
      processes: runtimeClient.processes,
      endpoints: runtimeClient.endpoints,
    });
  }

  return resolvedClients;
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  const sortedEntries = Object.entries(input).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  return Object.fromEntries(sortedEntries);
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

function runtimeArtifactCommandEquals(
  left: RuntimeArtifactCommand,
  right: RuntimeArtifactCommand,
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

  if (left.type === "none") {
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

  if (left.type === "ws" && right.type === "ws") {
    return left.url === right.url && left.timeoutMs === right.timeoutMs;
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
    runtimeArtifactCommandEquals(left.command, right.command) &&
    runtimeClientProcessReadinessEquals(left.readiness, right.readiness) &&
    runtimeClientProcessStopPolicyEquals(left.stop, right.stop)
  );
}

function runtimeClientEndpointSpecEquals(
  left: RuntimeClientEndpointSpec,
  right: RuntimeClientEndpointSpec,
): boolean {
  if (
    left.connectionMode !== right.connectionMode ||
    left.processKey !== right.processKey ||
    left.transport.type !== right.transport.type
  ) {
    return false;
  }

  if (left.transport.type === "ws" && right.transport.type === "ws") {
    return left.transport.url === right.transport.url;
  }

  return false;
}

function mergeRuntimeClients(input: ReadonlyArray<RuntimeClient>): ReadonlyArray<RuntimeClient> {
  const mergedByClientId = new Map<
    string,
    {
      env: Map<string, string>;
      filesByPath: Map<string, { fileId: string; mode: number; content: string }>;
      filesById: Map<string, { path: string; mode: number; content: string }>;
      launchArgs: string[];
      processesByKey: Map<string, RuntimeClientProcessSpec>;
      endpointsByKey: Map<string, RuntimeClientEndpointSpec>;
    }
  >();

  for (const runtimeClient of input) {
    let mergedClient = mergedByClientId.get(runtimeClient.clientId);
    if (mergedClient === undefined) {
      mergedClient = {
        env: new Map(),
        filesByPath: new Map(),
        filesById: new Map(),
        launchArgs: [],
        processesByKey: new Map(),
        endpointsByKey: new Map(),
      };
      mergedByClientId.set(runtimeClient.clientId, mergedClient);
    }

    for (const [envKey, envValue] of Object.entries(runtimeClient.setup.env)) {
      const existingValue = mergedClient.env.get(envKey);
      if (existingValue !== undefined && existingValue !== envValue) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client env conflict for client '${runtimeClient.clientId}' and key '${envKey}'.`,
        );
      }
      mergedClient.env.set(envKey, envValue);
    }

    for (const file of runtimeClient.setup.files) {
      const existingFileByPath = mergedClient.filesByPath.get(file.path);
      if (
        existingFileByPath !== undefined &&
        (existingFileByPath.fileId !== file.fileId ||
          existingFileByPath.mode !== file.mode ||
          existingFileByPath.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClient.clientId}' and path '${file.path}'.`,
        );
      }

      const existingFileById = mergedClient.filesById.get(file.fileId);
      if (
        existingFileById !== undefined &&
        (existingFileById.path !== file.path ||
          existingFileById.mode !== file.mode ||
          existingFileById.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClient.clientId}' and fileId '${file.fileId}'.`,
        );
      }

      mergedClient.filesByPath.set(file.path, {
        fileId: file.fileId,
        mode: file.mode,
        content: file.content,
      });
      mergedClient.filesById.set(file.fileId, {
        path: file.path,
        mode: file.mode,
        content: file.content,
      });
    }

    if (runtimeClient.setup.launchArgs !== undefined) {
      mergedClient.launchArgs.push(...runtimeClient.setup.launchArgs);
    }

    for (const process of runtimeClient.processes) {
      const existingProcess = mergedClient.processesByKey.get(process.processKey);
      if (existingProcess === undefined) {
        mergedClient.processesByKey.set(process.processKey, process);
        continue;
      }

      if (!runtimeClientProcessSpecEquals(existingProcess, process)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process conflict for client '${runtimeClient.clientId}' and processKey '${process.processKey}'.`,
        );
      }
    }

    for (const endpoint of runtimeClient.endpoints) {
      const existingEndpoint = mergedClient.endpointsByKey.get(endpoint.endpointKey);
      if (existingEndpoint === undefined) {
        mergedClient.endpointsByKey.set(endpoint.endpointKey, endpoint);
        continue;
      }

      if (!runtimeClientEndpointSpecEquals(existingEndpoint, endpoint)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client endpoint conflict for client '${runtimeClient.clientId}' and endpointKey '${endpoint.endpointKey}'.`,
        );
      }
    }
  }

  return [...mergedByClientId.entries()]
    .sort(([leftClientId], [rightClientId]) => leftClientId.localeCompare(rightClientId))
    .map(([clientId, mergedClient]) => {
      const env = sortRecord(Object.fromEntries(mergedClient.env.entries()));
      const files = [...mergedClient.filesByPath.entries()]
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, file]) => ({
          fileId: file.fileId,
          path,
          mode: file.mode,
          content: file.content,
        }));
      const processes = [...mergedClient.processesByKey.values()].sort((left, right) =>
        left.processKey.localeCompare(right.processKey),
      );
      const endpoints = [...mergedClient.endpointsByKey.values()].sort((left, right) =>
        left.endpointKey.localeCompare(right.endpointKey),
      );

      for (const endpoint of endpoints) {
        if (endpoint.processKey === undefined) {
          continue;
        }

        if (!mergedClient.processesByKey.has(endpoint.processKey)) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
            `Runtime client endpoint '${endpoint.endpointKey}' references missing process '${endpoint.processKey}' for client '${clientId}'.`,
          );
        }
      }

      return {
        clientId,
        setup: {
          env,
          files,
          ...(mergedClient.launchArgs.length === 0 ? {} : { launchArgs: mergedClient.launchArgs }),
        },
        processes,
        endpoints,
      };
    });
}

function sortArtifacts(
  input: ReadonlyArray<CompiledRuntimeArtifactSpec>,
): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  return [...input].sort((left, right) => left.artifactKey.localeCompare(right.artifactKey));
}

function computeArtifactRemovals(input: {
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  previousCompiledBindingResults: ReadonlyArray<CompiledBindingResult> | undefined;
}): ReadonlyArray<CompiledRuntimeArtifactRemovalSpec> {
  const previousCompiledBindingResults = input.previousCompiledBindingResults;
  if (previousCompiledBindingResults === undefined || previousCompiledBindingResults.length === 0) {
    return [];
  }

  const currentArtifactKeys = new Set(input.artifacts.map((artifact) => artifact.artifactKey));
  const previousArtifacts = sortArtifacts(flattenArtifacts(previousCompiledBindingResults));
  const removals: CompiledRuntimeArtifactRemovalSpec[] = [];

  for (const artifact of previousArtifacts) {
    if (currentArtifactKeys.has(artifact.artifactKey)) {
      continue;
    }

    removals.push({
      artifactKey: artifact.artifactKey,
      commands: artifact.lifecycle.remove,
    });
  }

  return removals;
}

export function assembleCompiledRuntimePlan(
  input: AssembleCompiledRuntimePlanInput,
): CompiledRuntimePlan {
  const routes = orderRoutesForMatching(
    input.compiledBindingResults.flatMap(
      (compiledBindingResult) => compiledBindingResult.egressRoutes,
    ),
  );
  const artifacts = sortArtifacts(flattenArtifacts(input.compiledBindingResults));
  const artifactRemovals = computeArtifactRemovals({
    artifacts,
    previousCompiledBindingResults: input.previousCompiledBindingResults,
  });
  const runtimeClients = mergeRuntimeClients(
    resolveRuntimeClients({
      runtimeClients: flattenRuntimeClients(input.compiledBindingResults),
    }),
  );
  const agentRuntimes = [...flattenAgentRuntimes(input.compiledBindingResults)].sort(
    (left, right) =>
      left.bindingId.localeCompare(right.bindingId) ||
      left.runtimeKey.localeCompare(right.runtimeKey) ||
      left.clientId.localeCompare(right.clientId) ||
      left.endpointKey.localeCompare(right.endpointKey),
  );
  const workspaceSources = [...flattenWorkspaceSources(input.compiledBindingResults)].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.originUrl.localeCompare(right.originUrl),
  );

  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: input.image,
    egressRoutes: routes,
    artifacts,
    artifactRemovals,
    workspaceSources,
    runtimeClients,
    agentRuntimes,
  };
}
