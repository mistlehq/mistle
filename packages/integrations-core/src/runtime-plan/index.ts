import { orderRoutesForMatching } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledBindingResult,
  CompiledRuntimePlan,
  RuntimeArtifactSpec,
  RuntimeClientSetup,
} from "../types/index.js";

type AssembleCompiledRuntimePlanInput = {
  sandboxProfileId: string;
  version: number;
  image: CompiledRuntimePlan["image"];
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
};

function flattenArtifacts(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<RuntimeArtifactSpec> {
  const artifacts: RuntimeArtifactSpec[] = [];

  for (const compiledBindingResult of input) {
    artifacts.push(...compiledBindingResult.artifacts);
  }

  return artifacts;
}

function flattenRuntimeClientSetups(
  input: ReadonlyArray<CompiledBindingResult>,
): ReadonlyArray<RuntimeClientSetup> {
  const runtimeClientSetups: RuntimeClientSetup[] = [];

  for (const compiledBindingResult of input) {
    runtimeClientSetups.push(...compiledBindingResult.runtimeClientSetups);
  }

  return runtimeClientSetups;
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
      files: Map<string, { mode: number; content: string }>;
      launchArgs: string[];
    }
  >();

  for (const setup of input) {
    let mergedSetup = mergedByClientId.get(setup.clientId);
    if (mergedSetup === undefined) {
      mergedSetup = {
        env: new Map(),
        files: new Map(),
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
      const existingFile = mergedSetup.files.get(file.path);
      if (
        existingFile !== undefined &&
        (existingFile.mode !== file.mode || existingFile.content !== file.content)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${setup.clientId}' and path '${file.path}'.`,
        );
      }

      mergedSetup.files.set(file.path, {
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
      const files = [...mergedSetup.files.entries()]
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, file]) => ({
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
  input: ReadonlyArray<RuntimeArtifactSpec>,
): ReadonlyArray<RuntimeArtifactSpec> {
  return [...input].sort((left, right) => {
    const installPathComparison = left.installPath.localeCompare(right.installPath);
    if (installPathComparison !== 0) {
      return installPathComparison;
    }

    return left.artifactId.localeCompare(right.artifactId);
  });
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
  const runtimeClientSetups = mergeRuntimeClientSetups(
    flattenRuntimeClientSetups(input.compiledBindingResults),
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
