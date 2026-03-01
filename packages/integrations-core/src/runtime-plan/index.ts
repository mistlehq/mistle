import { orderRoutesForMatching } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledBindingResult,
  CompiledRuntimeArtifactSpec,
  CompiledRuntimeClientSetup,
  CompiledRuntimePlan,
  EgressUrlRef,
  RuntimeClientSetup,
} from "../types/index.js";

type AssembleCompiledRuntimePlanInput = {
  sandboxProfileId: string;
  version: number;
  image: CompiledRuntimePlan["image"];
  runtimeContext: {
    sandboxdEgressBaseUrl: string;
  };
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
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

function flattenRuntimeClientSetups(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<CompiledRuntimeClientSetup> {
  const runtimeClientSetups: CompiledRuntimeClientSetup[] = [];

  for (const compiledBindingResult of input) {
    runtimeClientSetups.push(...compiledBindingResult.runtimeClientSetups);
  }

  return runtimeClientSetups;
}

function createEgressRouteBaseUrl(input: { egressBaseUrl: string; routeId: string }): string {
  const parsedEgressBaseUrl = new URL(input.egressBaseUrl);
  const normalizedBasePath =
    parsedEgressBaseUrl.pathname.endsWith("/") && parsedEgressBaseUrl.pathname !== "/"
      ? parsedEgressBaseUrl.pathname.slice(0, -1)
      : parsedEgressBaseUrl.pathname === "/"
        ? ""
        : parsedEgressBaseUrl.pathname;

  parsedEgressBaseUrl.pathname = `${normalizedBasePath}/routes/${encodeURIComponent(input.routeId)}`;
  parsedEgressBaseUrl.search = "";
  parsedEgressBaseUrl.hash = "";

  return parsedEgressBaseUrl.toString();
}

function resolveEgressUrlRef(input: {
  value: EgressUrlRef;
  routeIds: ReadonlySet<string>;
  egressBaseUrl: string;
}): string {
  if (!input.routeIds.has(input.value.routeId)) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF,
      `Runtime client setup referenced unknown egress route '${input.value.routeId}'.`,
    );
  }

  return createEgressRouteBaseUrl({
    egressBaseUrl: input.egressBaseUrl,
    routeId: input.value.routeId,
  });
}

function resolveRuntimeClientSetups(input: {
  runtimeClientSetups: ReadonlyArray<CompiledRuntimeClientSetup>;
  routeIds: ReadonlySet<string>;
  egressBaseUrl: string;
}): ReadonlyArray<RuntimeClientSetup> {
  const resolvedSetups: RuntimeClientSetup[] = [];

  for (const runtimeClientSetup of input.runtimeClientSetups) {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(runtimeClientSetup.env)) {
      if (typeof value === "string") {
        env[key] = value;
        continue;
      }

      env[key] = resolveEgressUrlRef({
        value,
        routeIds: input.routeIds,
        egressBaseUrl: input.egressBaseUrl,
      });
    }

    resolvedSetups.push({
      clientId: runtimeClientSetup.clientId,
      env,
      files: runtimeClientSetup.files,
      ...(runtimeClientSetup.launchArgs === undefined
        ? {}
        : { launchArgs: runtimeClientSetup.launchArgs }),
    });
  }

  return resolvedSetups;
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  const sortedEntries = Object.entries(input).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  return Object.fromEntries(sortedEntries);
}

function mergeRuntimeClientSetups(
  input: ReadonlyArray<RuntimeClientSetup>,
): ReadonlyArray<RuntimeClientSetup> {
  const mergedByClientId = new Map<
    string,
    {
      env: Map<string, string>;
      filesByPath: Map<string, { fileId: string; mode: number; content: string }>;
      filesById: Map<string, { path: string; mode: number; content: string }>;
      launchArgs: string[];
    }
  >();

  for (const setup of input) {
    let mergedSetup = mergedByClientId.get(setup.clientId);
    if (mergedSetup === undefined) {
      mergedSetup = {
        env: new Map(),
        filesByPath: new Map(),
        filesById: new Map(),
        launchArgs: [],
      };
      mergedByClientId.set(setup.clientId, mergedSetup);
    }

    for (const [envKey, envValue] of Object.entries(setup.env)) {
      const existingValue = mergedSetup.env.get(envKey);
      if (existingValue !== undefined && existingValue !== envValue) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client env conflict for client '${setup.clientId}' and key '${envKey}'.`,
        );
      }
      mergedSetup.env.set(envKey, envValue);
    }

    for (const file of setup.files) {
      const existingFileByPath = mergedSetup.filesByPath.get(file.path);
      if (
        existingFileByPath !== undefined &&
        (existingFileByPath.fileId !== file.fileId ||
          existingFileByPath.mode !== file.mode ||
          existingFileByPath.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${setup.clientId}' and path '${file.path}'.`,
        );
      }

      const existingFileById = mergedSetup.filesById.get(file.fileId);
      if (
        existingFileById !== undefined &&
        (existingFileById.path !== file.path ||
          existingFileById.mode !== file.mode ||
          existingFileById.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${setup.clientId}' and fileId '${file.fileId}'.`,
        );
      }

      mergedSetup.filesByPath.set(file.path, {
        fileId: file.fileId,
        mode: file.mode,
        content: file.content,
      });
      mergedSetup.filesById.set(file.fileId, {
        path: file.path,
        mode: file.mode,
        content: file.content,
      });
    }

    if (setup.launchArgs !== undefined) {
      mergedSetup.launchArgs.push(...setup.launchArgs);
    }
  }

  return [...mergedByClientId.entries()]
    .sort(([leftClientId], [rightClientId]) => leftClientId.localeCompare(rightClientId))
    .map(([clientId, mergedSetup]) => {
      const env = sortRecord(Object.fromEntries(mergedSetup.env.entries()));
      const files = [...mergedSetup.filesByPath.entries()]
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, file]) => ({
          fileId: file.fileId,
          path,
          mode: file.mode,
          content: file.content,
        }));

      const baseSetup = {
        clientId,
        env,
        files,
      };

      if (mergedSetup.launchArgs.length === 0) {
        return baseSetup;
      }

      return {
        ...baseSetup,
        launchArgs: mergedSetup.launchArgs,
      };
    });
}

function sortArtifacts(
  input: ReadonlyArray<CompiledRuntimeArtifactSpec>,
): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  return [...input].sort((left, right) => left.artifactKey.localeCompare(right.artifactKey));
}

export function assembleCompiledRuntimePlan(
  input: AssembleCompiledRuntimePlanInput,
): CompiledRuntimePlan {
  const routes = orderRoutesForMatching(
    input.compiledBindingResults.flatMap(
      (compiledBindingResult) => compiledBindingResult.egressRoutes,
    ),
  );
  const routeIds = new Set(routes.map((route) => route.routeId));
  const artifacts = sortArtifacts(flattenArtifacts(input.compiledBindingResults));
  const runtimeClientSetups = mergeRuntimeClientSetups(
    resolveRuntimeClientSetups({
      runtimeClientSetups: flattenRuntimeClientSetups(input.compiledBindingResults),
      routeIds,
      egressBaseUrl: input.runtimeContext.sandboxdEgressBaseUrl,
    }),
  );

  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: input.image,
    egressRoutes: routes,
    artifacts,
    runtimeClientSetups,
  };
}
