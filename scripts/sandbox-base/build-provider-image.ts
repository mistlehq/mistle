import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SandboxBaseImagePublishModes,
  SandboxBaseImageSourceKinds,
  SandboxSdkImageSandboxdSourceKinds,
  SandboxProvider,
  createSandboxBaseImageBuilder,
  createFreestyleSnapshotBaseImageName,
  createOpenComputerBaseImageName,
  createOpenComputerCheckpointImageHandle,
  createOpenComputerSnapshotImageHandle,
  createTensorlakeRegisteredBaseImageName,
} from "../../packages/sandbox/src/index.js";
import { OpenComputerClientOperationIds } from "../../packages/sandbox/src/providers/opencomputer/client-errors.js";
import {
  OpenComputerApiClient,
  createOpenComputerRootShellCommand,
  createOpenComputerBaseImage,
  createOpenComputerImageManifest,
} from "../../packages/sandbox/src/providers/opencomputer/client.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_REPOSITORY = "ghcr.io/mistlehq/sandbox-base";
const DEFAULT_PLATFORM = "linux/amd64";
const SANDBOX_BASE_DOCKERFILE_PATH = "packages/sandboxd/Dockerfile";
const OPENCOMPUTER_SANDBOXD_BINARY_PATH = "dev/.generated/sandbox-base/opencomputer/sandboxd";
const OPENCOMPUTER_SANDBOXD_ARCHIVE_PATH = `${OPENCOMPUTER_SANDBOXD_BINARY_PATH}.gz`;
const OPENCOMPUTER_SANDBOXD_ARCHIVE_PARTS_PATH =
  "dev/.generated/sandbox-base/opencomputer/sandboxd-parts";
const SANDBOX_BASE_TARGET = "sandbox-base";
const SANDBOX_BASE_SYSTEM_TESTS_TARGET = "sandbox-base-system-tests";
const SANDBOXD_BUILD_ARTIFACT_PATH = "/app/packages/sandboxd/target/release/sandboxd";
const OPENCOMPUTER_COPY_PART_SIZE = "64k";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SandboxBaseImageRefEnv = "MISTLE_SANDBOX_BASE_IMAGE_REF";
const E2BApiKeyEnv = "E2B_API_KEY";
const E2BConfigApiKeyEnv = "MISTLE_SANDBOX_E2B_API_KEY";
const FreestyleApiKeyEnv = "FREESTYLE_API_KEY";
const FreestyleConfigApiKeyEnv = "MISTLE_SANDBOX_FREESTYLE_API_KEY";
const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";
const TensorlakeConfigApiKeyEnv = "MISTLE_SANDBOX_TENSORLAKE_API_KEY";
const OpenComputerApiKeyEnv = "OPENCOMPUTER_API_KEY";
const OpenComputerConfigApiKeyEnv = "MISTLE_SANDBOX_OPENCOMPUTER_API_KEY";
const OpenComputerApiBaseUrlEnv = "OPENCOMPUTER_API_URL";
const OpenComputerConfigApiBaseUrlEnv = "MISTLE_SANDBOX_OPENCOMPUTER_API_BASE_URL";

const SandboxdSources = {
  LOCAL: "local",
  RELEASE: "release",
} as const;
type SandboxdSource = (typeof SandboxdSources)[keyof typeof SandboxdSources];
type SdkImageProvider =
  | typeof SandboxProvider.FREESTYLE
  | typeof SandboxProvider.OPENCOMPUTER
  | typeof SandboxProvider.TENSORLAKE;

type ParsedCliArguments = {
  additionalOutputImageRefs: string[];
  apiKey?: string;
  domain?: string;
  labels: Record<string, string>;
  memoryMb?: number;
  outputImageRef?: string;
  platform?: string;
  provider: SandboxProvider;
  publishMode: "load" | "push";
  repository: string;
  repositoryProvided: boolean;
  sourceImageRef?: string;
  sandboxdArtifactSha256?: string;
  sandboxdArtifactUrl?: string;
  sandboxdArtifactVersion?: string;
  sandboxdSource?: SandboxdSource;
  tag?: string;
  target?: string;
  cpuCount?: number;
};

function printUsage(): void {
  console.log(`Usage: pnpm sandbox-base:build --provider <provider> [options]

Builds or registers a sandbox base image for the selected provider.

Docker options:
  --output-image-ref <ref>             Output image ref to build
  --repository <ref>                   Image repository when --output-image-ref is omitted (default: ${DEFAULT_REPOSITORY})
  --tag <tag>                          Tag when --output-image-ref is omitted. Must start with dev- or sys-
  --additional-output-image-ref <ref>  Additional output tag. Can be repeated
  --platform <value>                   Docker platform (default: ${DEFAULT_PLATFORM})
  --target <target>                    Dockerfile target (sandbox-base or sandbox-base-system-tests)
  --publish-mode <push|load>           Publish mode (default: push)
  --label <key=value>                  Docker image label. Can be repeated

E2B options:
  --source-image-ref <ref>             OCI image ref to register as an E2B template
  --api-key <key>                      E2B API key
  --domain <domain>                    E2B API domain
  --cpu-count <count>                  E2B template CPU count
  --memory-mb <mb>                     E2B template memory in MB

Tensorlake options:
  --output-image-ref <name>            Tensorlake registered sandbox image name
                                          Defaults to the deterministic name for --source-image-ref
  --source-image-ref <ref>             OCI image ref to import into Tensorlake
  --api-key <key>                      Tensorlake API key
                                          Imports the registry image directly

OpenComputer options:
  --output-image-ref <name>            OpenComputer snapshot name
                                          Defaults to the deterministic name for --source-image-ref
                                          Only supported with --sandboxd-source release
  --source-image-ref <ref>             Source image ref used for deterministic naming and manifest identity
  --api-key <key>                      OpenComputer API key
  --domain <domain>                    OpenComputer API base URL
  --sandboxd-source <local|release>    sandboxd source for the OpenComputer image
                                          local creates a checkpoint image handle
                                          release creates a named snapshot image handle
  --sandboxd-artifact-url <url>        Release sandboxd artifact URL when --sandboxd-source release
  --sandboxd-artifact-sha256 <sha256>  Release sandboxd artifact SHA256 when --sandboxd-source release
  --sandboxd-artifact-version <value>  Release sandboxd version when --sandboxd-source release
  --platform <value>                   Linux platform for the sandboxd build artifact (default: ${DEFAULT_PLATFORM})
                                          Uses the OpenComputer SDK image builder

Freestyle options:
  --output-image-ref <name>            Freestyle snapshot name
                                          Defaults to the deterministic name for --source-image-ref
  --source-image-ref <ref>             Freestyle base image ref
  --api-key <key>                      Freestyle API key
  --sandboxd-source <release>          sandboxd source for the Freestyle SDK image
  --sandboxd-artifact-url <url>        Release sandboxd artifact URL when --sandboxd-source release
  --sandboxd-artifact-sha256 <sha256>  Release sandboxd artifact SHA256 when --sandboxd-source release
  --sandboxd-artifact-version <value>  Release sandboxd version when --sandboxd-source release

General options:
  --help                               Show this message
`);
}

function requireFlagValue(argv: readonly string[], index: number, flagName: string): string {
  const nextValue = argv[index + 1];
  if (nextValue === undefined || nextValue.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return nextValue;
}

function parsePositiveIntegerArgument(argumentName: string, value: string): number {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${argumentName} must be a positive integer.`);
  }

  return parsedValue;
}

function parseProvider(value: string): SandboxProvider {
  if (
    value === SandboxProvider.DOCKER ||
    value === SandboxProvider.E2B ||
    value === SandboxProvider.FREESTYLE ||
    value === SandboxProvider.OPENCOMPUTER ||
    value === SandboxProvider.TENSORLAKE
  ) {
    return value;
  }

  throw new Error(
    `--provider must be ${SandboxProvider.DOCKER}, ${SandboxProvider.E2B}, ${SandboxProvider.FREESTYLE}, ${SandboxProvider.OPENCOMPUTER}, or ${SandboxProvider.TENSORLAKE}.`,
  );
}

function parsePublishMode(value: string): "load" | "push" {
  if (value === SandboxBaseImagePublishModes.LOAD || value === SandboxBaseImagePublishModes.PUSH) {
    return value;
  }

  throw new Error("--publish-mode must be load or push.");
}

function parseSandboxdSource(value: string): SandboxdSource {
  if (value === SandboxdSources.LOCAL || value === SandboxdSources.RELEASE) {
    return value;
  }

  throw new Error("--sandboxd-source must be local or release.");
}

function parseLabel(value: string): readonly [string, string] {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("--label must be formatted as key=value.");
  }

  const key = value.slice(0, separatorIndex);
  const labelValue = value.slice(separatorIndex + 1);
  if (key.trim().length === 0) {
    throw new Error("--label key must not be empty.");
  }

  return [key, labelValue];
}

function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  const additionalOutputImageRefs: string[] = [];
  const labels: Record<string, string> = {};
  let apiKey: string | undefined;
  let cpuCount: number | undefined;
  let domain: string | undefined;
  let memoryMb: number | undefined;
  let outputImageRef: string | undefined;
  let platform: string | undefined;
  let provider: SandboxProvider | undefined;
  let publishMode: "load" | "push" = SandboxBaseImagePublishModes.PUSH;
  let repository = DEFAULT_REPOSITORY;
  let repositoryProvided = false;
  let sandboxdArtifactSha256: string | undefined;
  let sandboxdArtifactUrl: string | undefined;
  let sandboxdArtifactVersion: string | undefined;
  let sandboxdSource: SandboxdSource | undefined;
  let sourceImageRef: string | undefined;
  let tag: string | undefined;
  let target: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    }

    if (argument === "--provider") {
      provider = parseProvider(requireFlagValue(argv, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--output-image-ref") {
      outputImageRef = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--source-image-ref" || argument === "--image-ref") {
      sourceImageRef = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--repository") {
      repository = requireFlagValue(argv, index, argument);
      repositoryProvided = true;
      index += 1;
      continue;
    }

    if (argument === "--tag") {
      tag = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--additional-output-image-ref") {
      additionalOutputImageRefs.push(requireFlagValue(argv, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--platform") {
      platform = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--target") {
      target = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--publish-mode") {
      publishMode = parsePublishMode(requireFlagValue(argv, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--label") {
      const [key, value] = parseLabel(requireFlagValue(argv, index, argument));
      labels[key] = value;
      index += 1;
      continue;
    }

    if (argument === "--api-key") {
      apiKey = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--domain") {
      domain = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--cpu-count") {
      cpuCount = parsePositiveIntegerArgument(argument, requireFlagValue(argv, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--memory-mb") {
      memoryMb = parsePositiveIntegerArgument(argument, requireFlagValue(argv, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--sandboxd-source") {
      sandboxdSource = parseSandboxdSource(requireFlagValue(argv, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--sandboxd-artifact-url") {
      sandboxdArtifactUrl = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--sandboxd-artifact-sha256") {
      sandboxdArtifactSha256 = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--sandboxd-artifact-version") {
      sandboxdArtifactVersion = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (provider === undefined) {
    throw new Error("--provider is required.");
  }

  if (repository.trim().length === 0) {
    throw new Error("--repository must not be empty.");
  }

  if (platform !== undefined && platform.trim().length === 0) {
    throw new Error("--platform must not be empty.");
  }

  if (
    target !== undefined &&
    target !== SANDBOX_BASE_TARGET &&
    target !== SANDBOX_BASE_SYSTEM_TESTS_TARGET
  ) {
    throw new Error(
      `--target must be ${SANDBOX_BASE_TARGET} or ${SANDBOX_BASE_SYSTEM_TESTS_TARGET}.`,
    );
  }

  if (tag !== undefined && !tag.startsWith("dev-") && !tag.startsWith("sys-")) {
    throw new Error("--tag must start with dev- or sys-.");
  }

  return {
    additionalOutputImageRefs,
    labels,
    provider,
    publishMode,
    repository,
    repositoryProvided,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(cpuCount === undefined ? {} : { cpuCount }),
    ...(domain === undefined ? {} : { domain }),
    ...(memoryMb === undefined ? {} : { memoryMb }),
    ...(outputImageRef === undefined ? {} : { outputImageRef }),
    ...(platform === undefined ? {} : { platform }),
    ...(sandboxdArtifactSha256 === undefined ? {} : { sandboxdArtifactSha256 }),
    ...(sandboxdArtifactUrl === undefined ? {} : { sandboxdArtifactUrl }),
    ...(sandboxdArtifactVersion === undefined ? {} : { sandboxdArtifactVersion }),
    ...(sandboxdSource === undefined ? {} : { sandboxdSource }),
    ...(sourceImageRef === undefined ? {} : { sourceImageRef }),
    ...(tag === undefined ? {} : { tag }),
    ...(target === undefined ? {} : { target }),
  };
}

function readGitHeadSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function createDevTag(gitHeadSha: string): string {
  const uniqueInput = [gitHeadSha, new Date().toISOString(), randomUUID()].join("\n");
  const uniqueHash = createHash("sha256").update(uniqueInput).digest("hex").slice(0, 16);

  return `dev-${uniqueHash}`;
}

function prepareOpenComputerSandboxdBinary(platform: string): void {
  const archivePartsPath = resolve(REPO_ROOT, OPENCOMPUTER_SANDBOXD_ARCHIVE_PARTS_PATH);

  prepareLocalSandboxdArchive({
    archivePath: resolve(REPO_ROOT, OPENCOMPUTER_SANDBOXD_ARCHIVE_PATH),
    binaryPath: resolve(REPO_ROOT, OPENCOMPUTER_SANDBOXD_BINARY_PATH),
    buildImageTag: `mistle-sandboxd-opencomputer-build:${randomUUID()}`,
    label: "OpenComputer",
    platform,
  });

  rmSync(archivePartsPath, { force: true, recursive: true });
  mkdirSync(archivePartsPath, { recursive: true });
  execFileSync(
    "split",
    [
      "-b",
      OPENCOMPUTER_COPY_PART_SIZE,
      resolve(REPO_ROOT, OPENCOMPUTER_SANDBOXD_ARCHIVE_PATH),
      resolve(archivePartsPath, "part-"),
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
    },
  );

  console.log(
    `Prepared ${String(readdirSync(archivePartsPath).length)} OpenComputer sandboxd archive parts.`,
  );
}

function prepareLocalSandboxdArchive(input: {
  readonly archivePath: string;
  readonly binaryPath: string;
  readonly buildImageTag: string;
  readonly label: string;
  readonly platform: string;
}): void {
  const imageTag = input.buildImageTag;
  const binaryPath = input.binaryPath;
  const archivePath = input.archivePath;
  let containerId: string | undefined;
  let imageBuilt = false;
  let primaryError: unknown;

  console.log(`Building Linux sandboxd artifact for ${input.label} (${input.platform}).`);
  mkdirSync(dirname(binaryPath), { recursive: true });
  rmSync(binaryPath, { force: true });
  rmSync(archivePath, { force: true });

  try {
    execFileSync(
      "docker",
      [
        "build",
        "--platform",
        input.platform,
        "--target",
        "sandboxd-build",
        "--tag",
        imageTag,
        "-f",
        SANDBOX_BASE_DOCKERFILE_PATH,
        ".",
      ],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      },
    );
    imageBuilt = true;

    containerId = execFileSync("docker", ["create", "--platform", input.platform, imageTag], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();

    execFileSync("docker", ["cp", `${containerId}:${SANDBOXD_BUILD_ARTIFACT_PATH}`, binaryPath], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    execFileSync("gzip", ["-k", "-f", "-9", binaryPath], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });

    console.log(`Prepared ${input.label} sandboxd archive at ${archivePath}.`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (containerId !== undefined) {
      try {
        execFileSync("docker", ["rm", "-f", containerId], {
          cwd: REPO_ROOT,
          stdio: "ignore",
        });
      } catch (cleanupError) {
        if (primaryError === undefined) {
          throw cleanupError;
        }

        console.error(`Failed to remove temporary Docker container ${containerId}.`);
      }
    }

    if (imageBuilt) {
      try {
        execFileSync("docker", ["image", "rm", "-f", imageTag], {
          cwd: REPO_ROOT,
          stdio: "ignore",
        });
      } catch (cleanupError) {
        if (primaryError === undefined) {
          throw cleanupError;
        }

        console.error(`Failed to remove temporary Docker image ${imageTag}.`);
      }
    }
  }
}

function requireSdkSourceImageRef(
  argumentsList: ParsedCliArguments,
  provider: SdkImageProvider,
): NonNullable<ParsedCliArguments["sourceImageRef"]> {
  const sourceImageRef = argumentsList.sourceImageRef ?? readOptionalEnv(SandboxBaseImageRefEnv);

  if (sourceImageRef === undefined || sourceImageRef.trim() === "") {
    throw new Error(
      `--source-image-ref or ${SandboxBaseImageRefEnv} is required when --provider is ${provider}.`,
    );
  }

  return sourceImageRef;
}

function createSdkImageReleaseSandboxdSource(
  argumentsList: ParsedCliArguments,
  provider: SdkImageProvider,
): {
  kind: typeof SandboxSdkImageSandboxdSourceKinds.RELEASE;
  artifact: {
    version: string;
    url: string;
    sha256: string;
  };
} {
  const sandboxdSource = argumentsList.sandboxdSource;
  if (sandboxdSource === undefined) {
    throw new Error(`--sandboxd-source is required when --provider is ${provider}.`);
  }

  if (sandboxdSource !== SandboxdSources.RELEASE) {
    throw new Error(`--sandboxd-source must be release when --provider is ${provider}.`);
  }

  return createReleaseSandboxdSource(argumentsList, provider);
}

function createOpenComputerSandboxdSource(argumentsList: ParsedCliArguments):
  | {
      kind: typeof SandboxSdkImageSandboxdSourceKinds.LOCAL;
    }
  | {
      kind: typeof SandboxSdkImageSandboxdSourceKinds.RELEASE;
      artifact: {
        version: string;
        url: string;
        sha256: string;
      };
    } {
  const sandboxdSource = argumentsList.sandboxdSource;
  if (sandboxdSource === undefined) {
    throw new Error("--sandboxd-source is required when --provider is opencomputer.");
  }

  if (sandboxdSource === SandboxdSources.LOCAL) {
    return {
      kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
    };
  }

  return createReleaseSandboxdSource(argumentsList, SandboxProvider.OPENCOMPUTER);
}

function createReleaseSandboxdSource(
  argumentsList: ParsedCliArguments,
  provider: SdkImageProvider,
): {
  kind: typeof SandboxSdkImageSandboxdSourceKinds.RELEASE;
  artifact: {
    version: string;
    url: string;
    sha256: string;
  };
} {
  if (
    argumentsList.sandboxdArtifactUrl === undefined ||
    argumentsList.sandboxdArtifactUrl.trim() === ""
  ) {
    throw new Error(
      `--sandboxd-artifact-url is required when --provider is ${provider} and --sandboxd-source is release.`,
    );
  }

  if (
    argumentsList.sandboxdArtifactSha256 === undefined ||
    !SHA256_PATTERN.test(argumentsList.sandboxdArtifactSha256)
  ) {
    throw new Error(
      `--sandboxd-artifact-sha256 must be a lowercase SHA256 hex digest when --provider is ${provider} and --sandboxd-source is release.`,
    );
  }

  if (
    argumentsList.sandboxdArtifactVersion === undefined ||
    argumentsList.sandboxdArtifactVersion.trim() === ""
  ) {
    throw new Error(
      `--sandboxd-artifact-version is required when --provider is ${provider} and --sandboxd-source is release.`,
    );
  }

  return {
    kind: SandboxSdkImageSandboxdSourceKinds.RELEASE,
    artifact: {
      url: argumentsList.sandboxdArtifactUrl,
      sha256: argumentsList.sandboxdArtifactSha256,
      version: argumentsList.sandboxdArtifactVersion,
    },
  };
}

async function buildDockerBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  const gitHeadSha = readGitHeadSha();
  const tag = argumentsList.tag ?? createDevTag(gitHeadSha);
  const outputImageRef = argumentsList.outputImageRef ?? `${argumentsList.repository}:${tag}`;
  const platform = argumentsList.platform ?? DEFAULT_PLATFORM;
  const target = argumentsList.target ?? SANDBOX_BASE_TARGET;
  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.DOCKER,
  });

  console.log(`Building ${outputImageRef}`);
  console.log(`Source HEAD: ${gitHeadSha}`);
  console.log(`Platform: ${platform}`);
  console.log(`Target: ${target}`);

  await builder.ensureBaseImage({
    platform,
    source: {
      kind: SandboxBaseImageSourceKinds.DOCKERFILE,
      additionalImageIds: argumentsList.additionalOutputImageRefs,
      contextPath: REPO_ROOT,
      dockerfilePath: SANDBOX_BASE_DOCKERFILE_PATH,
      imageId: outputImageRef,
      labels: argumentsList.labels,
      publishMode: argumentsList.publishMode,
      target,
    },
  });

  console.log(`Built ${outputImageRef}`);
}

async function buildTensorlakeBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  const apiKey =
    argumentsList.apiKey ??
    readOptionalEnv(TensorlakeApiKeyEnv) ??
    readOptionalEnv(TensorlakeConfigApiKeyEnv);

  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      `--api-key, ${TensorlakeApiKeyEnv}, or ${TensorlakeConfigApiKeyEnv} is required when --provider is tensorlake.`,
    );
  }

  if (argumentsList.target !== undefined) {
    throw new Error(
      "--target is not supported when --provider is tensorlake. Tensorlake imports a prepared registry image.",
    );
  }

  if (argumentsList.platform !== undefined) {
    throw new Error("--platform is not supported when --provider is tensorlake.");
  }

  if (argumentsList.publishMode !== SandboxBaseImagePublishModes.PUSH) {
    throw new Error("--publish-mode must be push when --provider is tensorlake.");
  }

  if (Object.keys(argumentsList.labels).length > 0) {
    throw new Error("--label is not supported when --provider is tensorlake.");
  }

  const sourceImageRef = requireSdkSourceImageRef(argumentsList, SandboxProvider.TENSORLAKE);
  const outputImageRef =
    argumentsList.outputImageRef ?? createTensorlakeRegisteredBaseImageName(sourceImageRef);

  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.TENSORLAKE,
    tensorlake: {
      apiKey,
    },
  });

  console.log(`Registering Tensorlake sandbox image ${outputImageRef}.`);
  const image = await builder.ensureBaseImage({
    source: {
      kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
      baseImageRef: sourceImageRef,
      contextPath: REPO_ROOT,
      imageId: outputImageRef,
    },
  });

  console.log(`Tensorlake sandbox image is ready: ${image.imageId}.`);
}

async function buildFreestyleBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  const apiKey =
    argumentsList.apiKey ??
    readOptionalEnv(FreestyleApiKeyEnv) ??
    readOptionalEnv(FreestyleConfigApiKeyEnv);

  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      `--api-key, ${FreestyleApiKeyEnv}, or ${FreestyleConfigApiKeyEnv} is required when --provider is freestyle.`,
    );
  }

  if (argumentsList.target !== undefined) {
    throw new Error(
      "--target is not supported when --provider is freestyle. Freestyle uses the provider SDK image builder.",
    );
  }

  if (argumentsList.repositoryProvided) {
    throw new Error("--repository is not supported when --provider is freestyle.");
  }

  if (argumentsList.tag !== undefined) {
    throw new Error("--tag is not supported when --provider is freestyle.");
  }

  if (argumentsList.additionalOutputImageRefs.length > 0) {
    throw new Error("--additional-output-image-ref is not supported when --provider is freestyle.");
  }

  if (argumentsList.platform !== undefined) {
    throw new Error("--platform is not supported when --provider is freestyle.");
  }

  if (argumentsList.publishMode !== SandboxBaseImagePublishModes.PUSH) {
    throw new Error("--publish-mode must be push when --provider is freestyle.");
  }

  if (Object.keys(argumentsList.labels).length > 0) {
    throw new Error("--label is not supported when --provider is freestyle.");
  }

  const sourceImageRef = requireSdkSourceImageRef(argumentsList, SandboxProvider.FREESTYLE);
  const outputImageRef =
    argumentsList.outputImageRef ?? createFreestyleSnapshotBaseImageName(sourceImageRef);
  const sandboxd = createSdkImageReleaseSandboxdSource(argumentsList, SandboxProvider.FREESTYLE);
  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.FREESTYLE,
    freestyle: {
      apiKey,
    },
  });

  console.log(`Creating Freestyle sandbox snapshot ${outputImageRef}.`);
  const image = await builder.ensureBaseImage({
    source: {
      kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
      baseImageRef: sourceImageRef,
      contextPath: REPO_ROOT,
      imageId: outputImageRef,
      sandboxd,
    },
  });

  console.log(`Freestyle sandbox snapshot is ready: ${image.imageId}.`);
}

async function buildOpenComputerBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  const apiKey =
    argumentsList.apiKey ??
    readOptionalEnv(OpenComputerApiKeyEnv) ??
    readOptionalEnv(OpenComputerConfigApiKeyEnv);
  const apiBaseUrl =
    argumentsList.domain ??
    readOptionalEnv(OpenComputerApiBaseUrlEnv) ??
    readOptionalEnv(OpenComputerConfigApiBaseUrlEnv);

  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      `--api-key, ${OpenComputerApiKeyEnv}, or ${OpenComputerConfigApiKeyEnv} is required when --provider is opencomputer.`,
    );
  }

  if (argumentsList.target !== undefined) {
    throw new Error(
      "--target is not supported when --provider is opencomputer. OpenComputer uses the provider SDK image builder.",
    );
  }

  if (argumentsList.repositoryProvided) {
    throw new Error("--repository is not supported when --provider is opencomputer.");
  }

  if (argumentsList.tag !== undefined) {
    throw new Error("--tag is not supported when --provider is opencomputer.");
  }

  if (argumentsList.additionalOutputImageRefs.length > 0) {
    throw new Error(
      "--additional-output-image-ref is not supported when --provider is opencomputer.",
    );
  }

  if (argumentsList.publishMode !== SandboxBaseImagePublishModes.PUSH) {
    throw new Error("--publish-mode must be push when --provider is opencomputer.");
  }

  if (Object.keys(argumentsList.labels).length > 0) {
    throw new Error("--label is not supported when --provider is opencomputer.");
  }

  const sourceImageRef = requireSdkSourceImageRef(argumentsList, SandboxProvider.OPENCOMPUTER);
  const sandboxd = createOpenComputerSandboxdSource(argumentsList);
  if (sandboxd.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL) {
    const platform = argumentsList.platform ?? DEFAULT_PLATFORM;
    prepareOpenComputerSandboxdBinary(platform);
  } else if (argumentsList.platform !== undefined) {
    throw new Error("--platform is only supported when --sandboxd-source is local.");
  }

  if (
    sandboxd.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL &&
    argumentsList.outputImageRef !== undefined
  ) {
    throw new Error(
      "--output-image-ref is only supported when --provider is opencomputer and --sandboxd-source is release. Local OpenComputer builds produce checkpoint image handles.",
    );
  }

  if (sandboxd.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL) {
    await buildOpenComputerLocalCheckpointBaseImage({
      apiKey,
      sourceImageRef,
      ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    });
    return;
  }

  const image = createOpenComputerBaseImage({
    source: {
      kind: "sdk_image",
      imageId: argumentsList.outputImageRef ?? sourceImageRef,
      baseImageRef: sourceImageRef,
    },
    sandboxd,
  });

  const manifest = createOpenComputerImageManifest(image);
  const outputImageRef =
    argumentsList.outputImageRef ??
    createOpenComputerBaseImageName({
      baseImageRef: sourceImageRef,
      manifest,
    });
  const client = new OpenComputerApiClient({
    config: {
      apiKey,
      ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    },
  });

  console.log(`Creating OpenComputer sandbox snapshot ${outputImageRef}.`);
  await client.prepareImage({
    image: {
      kind: "image",
      id: outputImageRef,
      manifest,
    },
  });
  const imageHandle = createOpenComputerSnapshotImageHandle(outputImageRef);

  console.log(`OpenComputer sandbox snapshot is ready: ${imageHandle.imageId}.`);
}

async function buildOpenComputerLocalCheckpointBaseImage(input: {
  readonly apiBaseUrl?: string;
  readonly apiKey: string;
  readonly sourceImageRef: string;
}): Promise<void> {
  const client = new OpenComputerApiClient({
    config: {
      apiKey: input.apiKey,
      ...(input.apiBaseUrl === undefined ? {} : { apiBaseUrl: input.apiBaseUrl }),
    },
  });
  const image = createOpenComputerBaseImage({
    source: {
      kind: "sdk_image",
      imageId: input.sourceImageRef,
      baseImageRef: input.sourceImageRef,
    },
  });
  const manifest = createOpenComputerImageManifest(image);
  const bootstrapSnapshotName = createOpenComputerBaseImageName({
    baseImageRef: input.sourceImageRef,
    manifest,
  });
  let sandboxId: string | undefined;
  let primaryError: unknown;

  try {
    console.log(`Preparing OpenComputer bootstrap snapshot ${bootstrapSnapshotName}.`);
    const preparedImage = await client.prepareImage({
      image: {
        kind: "image",
        id: bootstrapSnapshotName,
        manifest,
      },
    });

    console.log("Creating OpenComputer sandbox for local sandboxd installation.");
    const sandbox = await client.startSandbox({
      image: preparedImage.image,
    });
    sandboxId = sandbox.sandboxId;

    await writeOpenComputerLocalSandboxdFiles({
      client,
      sandboxId,
    });
    await installOpenComputerLocalSandboxd({
      client,
      sandboxId,
    });

    console.log("Checkpointing OpenComputer sandbox with local sandboxd.");
    const checkpoint = await client.captureSandboxSnapshot({
      sandboxId,
      name: createOpenComputerLocalCheckpointName(input.sourceImageRef),
      requestTimeoutMs: 5 * 60 * 1000,
    });
    const imageHandle = createOpenComputerCheckpointImageHandle(checkpoint.checkpointId);

    console.log(`OpenComputer checkpoint image is ready: ${imageHandle.imageId}.`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (sandboxId !== undefined) {
      try {
        await client.destroySandbox({ sandboxId });
      } catch (cleanupError) {
        if (primaryError === undefined) {
          throw cleanupError;
        }
        console.error(`Failed to destroy temporary OpenComputer sandbox ${sandboxId}.`);
      }
    }
    await client.close();
  }
}

function createOpenComputerLocalCheckpointName(sourceImageRef: string): string {
  return createOpenComputerBaseImageName({
    baseImageRef: `local-sandboxd:${sourceImageRef}`,
  });
}

async function writeOpenComputerLocalSandboxdFiles(input: {
  readonly client: OpenComputerApiClient;
  readonly sandboxId: string;
}): Promise<void> {
  const archivePartsPath = resolve(REPO_ROOT, OPENCOMPUTER_SANDBOXD_ARCHIVE_PARTS_PATH);
  const partNames = readdirSync(archivePartsPath).sort();

  console.log(`Writing ${String(partNames.length)} sandboxd archive parts to OpenComputer.`);
  for (const [index, partName] of partNames.entries()) {
    await input.client.writeFile({
      sandboxId: input.sandboxId,
      path: `/tmp/sandboxd-parts/${partName}`,
      content: readFileSync(resolve(archivePartsPath, partName)),
    });
    if ((index + 1) % 10 === 0 || index + 1 === partNames.length) {
      console.log(`Wrote ${String(index + 1)} of ${String(partNames.length)} sandboxd parts.`);
    }
  }

  await input.client.writeFile({
    sandboxId: input.sandboxId,
    path: "/tmp/cmddir",
    content: readFileSync(resolve(REPO_ROOT, "packages/sandboxd/scripts/cmddir")),
  });
}

async function installOpenComputerLocalSandboxd(input: {
  readonly client: OpenComputerApiClient;
  readonly sandboxId: string;
}): Promise<void> {
  const command = createOpenComputerRootShellCommand({
    script: [
      "set -eu",
      "install -d -m 0755 /opt/mistle/bin",
      "cat /tmp/sandboxd-parts/part-* > /tmp/sandboxd.gz",
      "gzip -dc /tmp/sandboxd.gz > /opt/mistle/bin/sandboxd",
      "install -m 0755 /tmp/cmddir /opt/mistle/bin/cmddir",
      "chmod 0755 /opt/mistle/bin/sandboxd",
      "ln -sf sandboxd /opt/mistle/bin/mistle-ssh-sign",
      "ln -sf sandboxd /usr/local/bin/sandboxd",
      "ln -sf mistle-ssh-sign /usr/local/bin/mistle-ssh-sign",
      "ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir",
      "rm -rf /tmp/sandboxd.gz /tmp/sandboxd-parts /tmp/cmddir",
      "/opt/mistle/bin/sandboxd version",
    ].join("\n"),
  });
  const result = await input.client.runCommand({
    sandboxId: input.sandboxId,
    command: command.command,
    args: command.args,
    operation: OpenComputerClientOperationIds.BUILD_BASE_IMAGE,
    commandDescription: "Install local sandboxd in OpenComputer sandbox",
    timeoutMs: 60_000,
  });

  console.log(`Installed sandboxd ${result.stdout.trim()}.`);
}

async function buildE2BBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  const sourceImageRef = argumentsList.sourceImageRef ?? readOptionalEnv(SandboxBaseImageRefEnv);
  const apiKey =
    argumentsList.apiKey ?? readOptionalEnv(E2BApiKeyEnv) ?? readOptionalEnv(E2BConfigApiKeyEnv);

  if (sourceImageRef === undefined || sourceImageRef.trim() === "") {
    throw new Error(
      `--source-image-ref or ${SandboxBaseImageRefEnv} is required when --provider is e2b.`,
    );
  }

  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      `--api-key, ${E2BApiKeyEnv}, or ${E2BConfigApiKeyEnv} is required when --provider is e2b.`,
    );
  }

  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.E2B,
    e2b: {
      apiKey,
      ...(argumentsList.cpuCount === undefined ? {} : { cpuCount: argumentsList.cpuCount }),
      ...(argumentsList.domain === undefined ? {} : { domain: argumentsList.domain }),
      ...(argumentsList.memoryMb === undefined ? {} : { memoryMb: argumentsList.memoryMb }),
    },
  });

  console.log(`Ensuring E2B template for ${sourceImageRef}.`);
  const image = await builder.ensureBaseImage({
    source: {
      kind: SandboxBaseImageSourceKinds.IMAGE,
      imageId: sourceImageRef,
    },
  });

  console.log(`E2B template image is ready: ${image.imageId}.`);
}

async function main(): Promise<void> {
  const argumentsList = parseCliArguments(process.argv.slice(2));

  if (argumentsList.provider === SandboxProvider.DOCKER) {
    await buildDockerBaseImage(argumentsList);
    return;
  }

  if (argumentsList.provider === SandboxProvider.E2B) {
    await buildE2BBaseImage(argumentsList);
    return;
  }

  if (argumentsList.provider === SandboxProvider.FREESTYLE) {
    await buildFreestyleBaseImage(argumentsList);
    return;
  }

  if (argumentsList.provider === SandboxProvider.OPENCOMPUTER) {
    await buildOpenComputerBaseImage(argumentsList);
    return;
  }

  if (argumentsList.provider === SandboxProvider.TENSORLAKE) {
    await buildTensorlakeBaseImage(argumentsList);
    return;
  }

  throw new Error("Unsupported sandbox provider.");
}

await main();
