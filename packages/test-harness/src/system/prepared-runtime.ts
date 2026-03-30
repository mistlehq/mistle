import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PreparedTestHarnessRuntimeFileRelativePath = ".local/test-harness/runtime.json";
export const SANDBOX_SNAPSHOT_REPOSITORY_PATH = "mistle/snapshots";

export type SandboxBaseImageBuild = {
  localReference: string;
  repositoryPath: string;
  dockerfilePath: string;
  dockerTarget: string;
};

export const DefaultSandboxBaseImageBuild: SandboxBaseImageBuild = {
  localReference: "mistle/sandbox-base:dev",
  repositoryPath: "mistle/sandbox-base",
  dockerfilePath: "apps/sandbox-runtime/Dockerfile",
  dockerTarget: "sandbox-base",
};

export type PreparedTestHarnessDockerAppName =
  | "controlPlaneApi"
  | "controlPlaneWorker"
  | "dataPlaneApi"
  | "dataPlaneGateway"
  | "dataPlaneWorker"
  | "tokenizerProxy";

export type PreparedTestHarnessDockerAppBuild = {
  appName: PreparedTestHarnessDockerAppName;
  dockerfileRelativePath: string;
  dockerTarget: string;
};

export const PreparedTestHarnessDockerAppBuilds: readonly PreparedTestHarnessDockerAppBuild[] = [
  {
    appName: "controlPlaneApi",
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "control-plane-api-test-runtime",
  },
  {
    appName: "controlPlaneWorker",
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "control-plane-worker-test-runtime",
  },
  {
    appName: "dataPlaneApi",
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "data-plane-api-test-runtime",
  },
  {
    appName: "dataPlaneGateway",
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "data-plane-gateway-test-runtime",
  },
  {
    appName: "dataPlaneWorker",
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "data-plane-worker-test-runtime",
  },
  {
    appName: "tokenizerProxy",
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "tokenizer-proxy-test-runtime",
  },
] as const;

export type PreparedTestHarnessRuntime = {
  schemaVersion: 2;
  provider: "docker";
  fingerprint: PreparedTestHarnessRuntimeFingerprint;
  sandboxBaseImage: {
    localReference: string;
    repositoryPath: string;
  };
  appImages: Record<PreparedTestHarnessDockerAppName, string>;
};

export type PreparedTestHarnessRuntimeFingerprint = {
  architecture: NodeJS.Architecture;
  dockerContextFingerprint: string;
  seaContextFingerprint: string;
  sandboxBaseImageFingerprint: string;
  appImageFingerprints: Record<PreparedTestHarnessDockerAppName, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreparedDockerAppName(value: string): value is PreparedTestHarnessDockerAppName {
  return PreparedTestHarnessDockerAppBuilds.some((build) => build.appName === value);
}

function isNodeArchitecture(value: string): value is NodeJS.Architecture {
  switch (value) {
    case "arm":
    case "arm64":
    case "ia32":
    case "loong64":
    case "mips":
    case "mipsel":
    case "ppc":
    case "ppc64":
    case "riscv64":
    case "s390":
    case "s390x":
    case "x64":
      return true;
    default:
      return false;
  }
}

function parsePreparedDockerAppStringRecord(input: {
  rawValue: unknown;
  missingContainerLabel: string;
  missingEntryLabel: string;
  unknownEntryLabel: string;
  invalidEntryLabel: string;
}): Record<PreparedTestHarnessDockerAppName, string> {
  if (!isRecord(input.rawValue)) {
    throw new Error(input.missingContainerLabel);
  }

  const parsedValues: Partial<Record<PreparedTestHarnessDockerAppName, string>> = {};

  for (const [appName, rawEntryValue] of Object.entries(input.rawValue)) {
    if (!isPreparedDockerAppName(appName)) {
      throw new Error(`${input.unknownEntryLabel} '${appName}'.`);
    }
    if (typeof rawEntryValue !== "string" || rawEntryValue.length === 0) {
      throw new Error(`${input.invalidEntryLabel} '${appName}'.`);
    }
    parsedValues[appName] = rawEntryValue;
  }

  for (const build of PreparedTestHarnessDockerAppBuilds) {
    if (parsedValues[build.appName] === undefined) {
      throw new Error(`${input.missingEntryLabel} '${build.appName}'.`);
    }
  }

  const controlPlaneApi = parsedValues.controlPlaneApi;
  const controlPlaneWorker = parsedValues.controlPlaneWorker;
  const dataPlaneApi = parsedValues.dataPlaneApi;
  const dataPlaneGateway = parsedValues.dataPlaneGateway;
  const dataPlaneWorker = parsedValues.dataPlaneWorker;
  const tokenizerProxy = parsedValues.tokenizerProxy;

  if (
    controlPlaneApi === undefined ||
    controlPlaneWorker === undefined ||
    dataPlaneApi === undefined ||
    dataPlaneGateway === undefined ||
    dataPlaneWorker === undefined ||
    tokenizerProxy === undefined
  ) {
    throw new Error(
      "Prepared test-harness runtime manifest is missing required docker app entries.",
    );
  }

  return {
    controlPlaneApi,
    controlPlaneWorker,
    dataPlaneApi,
    dataPlaneGateway,
    dataPlaneWorker,
    tokenizerProxy,
  };
}

function parsePreparedRuntime(rawValue: unknown): PreparedTestHarnessRuntime {
  if (!isRecord(rawValue)) {
    throw new Error("Prepared test-harness runtime manifest must be an object.");
  }

  if (rawValue.schemaVersion !== 2) {
    throw new Error("Prepared test-harness runtime manifest has an unsupported schemaVersion.");
  }
  if (rawValue.provider !== "docker") {
    throw new Error("Prepared test-harness runtime manifest has an unsupported provider.");
  }

  const fingerprint = rawValue.fingerprint;
  if (!isRecord(fingerprint)) {
    throw new Error("Prepared test-harness runtime manifest is missing fingerprint.");
  }
  if (
    typeof fingerprint.architecture !== "string" ||
    !isNodeArchitecture(fingerprint.architecture)
  ) {
    throw new Error("Prepared test-harness runtime manifest is missing fingerprint.architecture.");
  }
  if (
    typeof fingerprint.dockerContextFingerprint !== "string" ||
    fingerprint.dockerContextFingerprint.length === 0
  ) {
    throw new Error(
      "Prepared test-harness runtime manifest is missing fingerprint.dockerContextFingerprint.",
    );
  }
  if (
    typeof fingerprint.seaContextFingerprint !== "string" ||
    fingerprint.seaContextFingerprint.length === 0
  ) {
    throw new Error(
      "Prepared test-harness runtime manifest is missing fingerprint.seaContextFingerprint.",
    );
  }
  if (
    typeof fingerprint.sandboxBaseImageFingerprint !== "string" ||
    fingerprint.sandboxBaseImageFingerprint.length === 0
  ) {
    throw new Error(
      "Prepared test-harness runtime manifest is missing fingerprint.sandboxBaseImageFingerprint.",
    );
  }
  const parsedAppImageFingerprints = parsePreparedDockerAppStringRecord({
    rawValue: fingerprint.appImageFingerprints,
    missingContainerLabel:
      "Prepared test-harness runtime manifest is missing fingerprint.appImageFingerprints.",
    missingEntryLabel: "Prepared test-harness runtime manifest is missing app image fingerprint",
    unknownEntryLabel: "Prepared test-harness runtime manifest contains unknown fingerprint app",
    invalidEntryLabel: "Prepared test-harness runtime manifest is missing a valid fingerprint for",
  });

  const sandboxBaseImage = rawValue.sandboxBaseImage;
  if (!isRecord(sandboxBaseImage)) {
    throw new Error("Prepared test-harness runtime manifest is missing sandboxBaseImage.");
  }
  if (
    typeof sandboxBaseImage.localReference !== "string" ||
    sandboxBaseImage.localReference.length === 0
  ) {
    throw new Error(
      "Prepared test-harness runtime manifest is missing sandboxBaseImage.localReference.",
    );
  }
  if (
    typeof sandboxBaseImage.repositoryPath !== "string" ||
    sandboxBaseImage.repositoryPath.length === 0
  ) {
    throw new Error(
      "Prepared test-harness runtime manifest is missing sandboxBaseImage.repositoryPath.",
    );
  }

  const parsedAppImages = parsePreparedDockerAppStringRecord({
    rawValue: rawValue.appImages,
    missingContainerLabel: "Prepared test-harness runtime manifest is missing appImages.",
    missingEntryLabel: "Prepared test-harness runtime manifest is missing image",
    unknownEntryLabel: "Prepared test-harness runtime manifest contains unknown app",
    invalidEntryLabel: "Prepared test-harness runtime manifest is missing a valid image for",
  });

  return {
    schemaVersion: 2,
    provider: "docker",
    fingerprint: {
      architecture: fingerprint.architecture,
      dockerContextFingerprint: fingerprint.dockerContextFingerprint,
      seaContextFingerprint: fingerprint.seaContextFingerprint,
      sandboxBaseImageFingerprint: fingerprint.sandboxBaseImageFingerprint,
      appImageFingerprints: parsedAppImageFingerprints,
    },
    sandboxBaseImage: {
      localReference: sandboxBaseImage.localReference,
      repositoryPath: sandboxBaseImage.repositoryPath,
    },
    appImages: parsedAppImages,
  };
}

export function resolvePreparedTestHarnessRuntimePath(buildContextHostPath: string): string {
  return resolve(buildContextHostPath, PreparedTestHarnessRuntimeFileRelativePath);
}

export async function readPreparedTestHarnessRuntime(
  buildContextHostPath: string,
): Promise<PreparedTestHarnessRuntime> {
  const runtimePath = resolvePreparedTestHarnessRuntimePath(buildContextHostPath);

  let rawManifest: string;
  try {
    rawManifest = await readFile(runtimePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing prepared test-harness runtime manifest at ${runtimePath}: ${message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Prepared test-harness runtime manifest at ${runtimePath} is not valid JSON: ${message}`,
    );
  }

  return parsePreparedRuntime(parsedJson);
}

export async function writePreparedTestHarnessRuntime(input: {
  buildContextHostPath: string;
  runtime: PreparedTestHarnessRuntime;
}): Promise<string> {
  const runtimePath = resolvePreparedTestHarnessRuntimePath(input.buildContextHostPath);
  await mkdir(resolve(input.buildContextHostPath, ".local/test-harness"), { recursive: true });
  await writeFile(runtimePath, `${JSON.stringify(input.runtime, null, 2)}\n`, "utf8");
  return runtimePath;
}
