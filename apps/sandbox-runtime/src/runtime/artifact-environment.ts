import type { RuntimeArtifactSpec } from "@mistle/integrations-core";

type ArtifactEnvironmentOrigin = {
  artifactIndex: number;
  artifactKey: string;
};

export function aggregateArtifactEnvironment(
  artifacts: ReadonlyArray<RuntimeArtifactSpec>,
): Record<string, string> | undefined {
  const aggregated: Record<string, string> = {};
  const origins = new Map<string, ArtifactEnvironmentOrigin>();

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    if (artifact.env === undefined) {
      continue;
    }

    for (const [envKey, envValue] of Object.entries(artifact.env)) {
      const origin = origins.get(envKey);
      if (origin !== undefined) {
        if (aggregated[envKey] === envValue) {
          continue;
        }

        throw new Error(
          `artifact env key "${envKey}" conflicts between artifacts[${String(origin.artifactIndex)}] (${origin.artifactKey}) and artifacts[${String(artifactIndex)}] (${artifact.artifactKey})`,
        );
      }

      aggregated[envKey] = envValue;
      origins.set(envKey, {
        artifactIndex,
        artifactKey: artifact.artifactKey,
      });
    }
  }

  return Object.keys(aggregated).length === 0 ? undefined : aggregated;
}
