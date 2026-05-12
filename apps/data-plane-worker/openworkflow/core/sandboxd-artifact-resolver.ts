const ReleaseManifestBaseUrl = "https://github.com/mistlehq/mistle/releases/download";
const SandboxdArtifactTarget = "x86_64-unknown-linux-gnu";
const ReleaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.(0|[1-9]\d*))?$/u;
const Sha256Pattern = /^[a-f0-9]{64}$/u;

export type SandboxdArtifact = {
  version: string;
  target: typeof SandboxdArtifactTarget;
  url: string;
  sha256: string;
};

export type SandboxdArtifactResolver = {
  resolve(): Promise<SandboxdArtifact>;
};

export function createSandboxdArtifactResolver(input: {
  releaseVersion: string;
}): SandboxdArtifactResolver {
  if (!ReleaseVersionPattern.test(input.releaseVersion)) {
    throw new Error(
      `Data-plane worker release version must match x.y.z or x.y.z-alpha.n. Received: ${input.releaseVersion}`,
    );
  }

  let cachedArtifactPromise: Promise<SandboxdArtifact> | undefined;

  return {
    resolve: () => {
      const manifestUrl = `${ReleaseManifestBaseUrl}/v${input.releaseVersion}/release-manifest.json`;
      cachedArtifactPromise ??= fetchSandboxdArtifact({
        manifestUrl,
        releaseVersion: input.releaseVersion,
      });
      return cachedArtifactPromise;
    },
  };
}

async function fetchSandboxdArtifact(input: {
  manifestUrl: string;
  releaseVersion: string;
}): Promise<SandboxdArtifact> {
  const response = await fetch(input.manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch release manifest '${input.manifestUrl}': ${String(response.status)} ${response.statusText}`,
    );
  }

  return parseSandboxdArtifactFromReleaseManifest({
    releaseVersion: input.releaseVersion,
    manifest: await response.json(),
  });
}

export function parseSandboxdArtifactFromReleaseManifest(input: {
  manifest: unknown;
  releaseVersion: string;
}): SandboxdArtifact {
  if (!ReleaseVersionPattern.test(input.releaseVersion)) {
    throw new Error(
      `Release manifest version must match x.y.z or x.y.z-alpha.n. Received: ${input.releaseVersion}`,
    );
  }

  const manifest = requireRecord(input.manifest, "Release manifest");
  const expectedReleaseTag = `v${input.releaseVersion}`;
  const manifestVersion = requireString(manifest, "version", "Release manifest version");
  if (manifestVersion !== expectedReleaseTag) {
    throw new Error(
      `Release manifest version '${manifestVersion}' does not match expected release '${expectedReleaseTag}'.`,
    );
  }

  const artifacts = requireRecord(manifest.artifacts, "Release manifest artifacts");
  const sandboxd = requireRecord(artifacts.sandboxd, "Release manifest sandboxd artifact");
  const artifactVersion = requireString(
    sandboxd,
    "version",
    "Release manifest sandboxd artifact version",
  );
  if (artifactVersion !== input.releaseVersion) {
    throw new Error(
      `Sandboxd artifact version '${artifactVersion}' does not match worker release version '${input.releaseVersion}'.`,
    );
  }

  const target = requireString(sandboxd, "target", "Release manifest sandboxd artifact target");
  if (target !== SandboxdArtifactTarget) {
    throw new Error(
      `Sandboxd artifact target '${target}' does not match expected target '${SandboxdArtifactTarget}'.`,
    );
  }

  const url = requireString(sandboxd, "url", "Release manifest sandboxd artifact URL");
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(url);
  } catch (error) {
    throw new Error("Release manifest sandboxd artifact URL must be a valid URL.", {
      cause: error,
    });
  }

  if (artifactUrl.protocol !== "https:") {
    throw new Error("Release manifest sandboxd artifact URL must use https.");
  }

  const sha256 = requireString(sandboxd, "sha256", "Release manifest sandboxd artifact SHA256");
  if (!Sha256Pattern.test(sha256)) {
    throw new Error("Release manifest sandboxd artifact SHA256 must be a lowercase hex digest.");
  }

  return {
    version: artifactVersion,
    target,
    url,
    sha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}
