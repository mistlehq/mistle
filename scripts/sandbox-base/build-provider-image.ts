import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SandboxBaseImagePublishModes,
  SandboxBaseImageSourceKinds,
  SandboxSdkImageSandboxdSourceKinds,
  SandboxProvider,
  createSandboxBaseImageBuilder,
} from "../../packages/sandbox/src/index.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_REPOSITORY = "ghcr.io/mistlehq/sandbox-base";
const DEFAULT_PLATFORM = "linux/amd64";
const SANDBOX_BASE_DOCKERFILE_PATH = "packages/sandboxd/Dockerfile";
const TENSORLAKE_SANDBOXD_BINARY_PATH = "packages/sandboxd/.generated/tensorlake/sandboxd";
const TENSORLAKE_SANDBOXD_ARCHIVE_PATH = `${TENSORLAKE_SANDBOXD_BINARY_PATH}.gz`;
const TENSORLAKE_SANDBOXD_ARCHIVE_PARTS_PATH =
  "packages/sandboxd/.generated/tensorlake/sandboxd-parts";
const SANDBOX_BASE_TARGET = "sandbox-base";
const SANDBOX_BASE_SYSTEM_TESTS_TARGET = "sandbox-base-system-tests";
const SANDBOXD_BUILD_ARTIFACT_PATH = "/app/packages/sandboxd/target/release/sandboxd";
const TENSORLAKE_COPY_PART_SIZE = "512k";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const TensorlakeSandboxdSources = {
  LOCAL: "local",
  RELEASE: "release",
} as const;
type TensorlakeSandboxdSource =
  (typeof TensorlakeSandboxdSources)[keyof typeof TensorlakeSandboxdSources];

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
  sourceImageRef?: string;
  sandboxdArtifactSha256?: string;
  sandboxdArtifactUrl?: string;
  sandboxdArtifactVersion?: string;
  sandboxdSource?: TensorlakeSandboxdSource;
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
  --api-key <key>                      Tensorlake API key
  --sandboxd-source <local|release>    sandboxd source for the Tensorlake SDK image
  --sandboxd-artifact-url <url>        Release sandboxd artifact URL when --sandboxd-source release
  --sandboxd-artifact-sha256 <sha256>  Release sandboxd artifact SHA256 when --sandboxd-source release
  --sandboxd-artifact-version <value>  Release sandboxd version when --sandboxd-source release
  --platform <value>                   Linux platform for the sandboxd build artifact (default: ${DEFAULT_PLATFORM})
                                          Uses the Tensorlake SDK image builder

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
    value === SandboxProvider.TENSORLAKE
  ) {
    return value;
  }

  throw new Error(
    `--provider must be ${SandboxProvider.DOCKER}, ${SandboxProvider.E2B}, or ${SandboxProvider.TENSORLAKE}.`,
  );
}

function parsePublishMode(value: string): "load" | "push" {
  if (value === SandboxBaseImagePublishModes.LOAD || value === SandboxBaseImagePublishModes.PUSH) {
    return value;
  }

  throw new Error("--publish-mode must be load or push.");
}

function parseTensorlakeSandboxdSource(value: string): TensorlakeSandboxdSource {
  if (value === TensorlakeSandboxdSources.LOCAL || value === TensorlakeSandboxdSources.RELEASE) {
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
  let sandboxdArtifactSha256: string | undefined;
  let sandboxdArtifactUrl: string | undefined;
  let sandboxdArtifactVersion: string | undefined;
  let sandboxdSource: TensorlakeSandboxdSource | undefined;
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
      sandboxdSource = parseTensorlakeSandboxdSource(requireFlagValue(argv, index, argument));
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

function createDevTag(gitHeadSha: string): string {
  const uniqueInput = [gitHeadSha, new Date().toISOString(), randomUUID()].join("\n");
  const uniqueHash = createHash("sha256").update(uniqueInput).digest("hex").slice(0, 16);

  return `dev-${uniqueHash}`;
}

function prepareTensorlakeSandboxdBinary(platform: string): void {
  const imageTag = `mistle-sandboxd-tensorlake-build:${randomUUID()}`;
  const binaryPath = resolve(REPO_ROOT, TENSORLAKE_SANDBOXD_BINARY_PATH);
  const archivePath = resolve(REPO_ROOT, TENSORLAKE_SANDBOXD_ARCHIVE_PATH);
  const archivePartsPath = resolve(REPO_ROOT, TENSORLAKE_SANDBOXD_ARCHIVE_PARTS_PATH);
  let containerId: string | undefined;
  let imageBuilt = false;
  let primaryError: unknown;

  console.log(`Building Linux sandboxd artifact for Tensorlake (${platform}).`);
  mkdirSync(dirname(binaryPath), { recursive: true });
  rmSync(binaryPath, { force: true });
  rmSync(archivePath, { force: true });
  rmSync(archivePartsPath, { force: true, recursive: true });
  mkdirSync(archivePartsPath, { recursive: true });

  try {
    execFileSync(
      "docker",
      [
        "build",
        "--platform",
        platform,
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

    containerId = execFileSync("docker", ["create", "--platform", platform, imageTag], {
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
    execFileSync(
      "split",
      ["-b", TENSORLAKE_COPY_PART_SIZE, archivePath, resolve(archivePartsPath, "part-")],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      },
    );

    console.log(
      `Prepared ${String(readdirSync(archivePartsPath).length)} Tensorlake sandboxd archive parts.`,
    );
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

function requireTensorlakeSandboxdSource(
  argumentsList: ParsedCliArguments,
): NonNullable<ParsedCliArguments["sandboxdSource"]> {
  if (argumentsList.sandboxdSource === undefined) {
    throw new Error("--sandboxd-source is required when --provider is tensorlake.");
  }

  return argumentsList.sandboxdSource;
}

function createTensorlakeSandboxdSource(argumentsList: ParsedCliArguments):
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
  const sandboxdSource = requireTensorlakeSandboxdSource(argumentsList);
  if (sandboxdSource === TensorlakeSandboxdSources.LOCAL) {
    return {
      kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
    };
  }

  if (
    argumentsList.sandboxdArtifactUrl === undefined ||
    argumentsList.sandboxdArtifactUrl.trim() === ""
  ) {
    throw new Error(
      "--sandboxd-artifact-url is required when --provider is tensorlake and --sandboxd-source is release.",
    );
  }

  if (
    argumentsList.sandboxdArtifactSha256 === undefined ||
    !SHA256_PATTERN.test(argumentsList.sandboxdArtifactSha256)
  ) {
    throw new Error(
      "--sandboxd-artifact-sha256 must be a lowercase SHA256 hex digest when --provider is tensorlake and --sandboxd-source is release.",
    );
  }

  if (
    argumentsList.sandboxdArtifactVersion === undefined ||
    argumentsList.sandboxdArtifactVersion.trim() === ""
  ) {
    throw new Error(
      "--sandboxd-artifact-version is required when --provider is tensorlake and --sandboxd-source is release.",
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
  if (argumentsList.outputImageRef === undefined || argumentsList.outputImageRef.trim() === "") {
    throw new Error("--output-image-ref is required when --provider is tensorlake.");
  }

  if (argumentsList.apiKey === undefined || argumentsList.apiKey.trim() === "") {
    throw new Error("--api-key is required when --provider is tensorlake.");
  }

  if (argumentsList.target !== undefined) {
    throw new Error(
      "--target is not supported when --provider is tensorlake. Tensorlake uses the provider SDK image builder.",
    );
  }

  if (argumentsList.publishMode !== SandboxBaseImagePublishModes.PUSH) {
    throw new Error("--publish-mode must be push when --provider is tensorlake.");
  }

  if (Object.keys(argumentsList.labels).length > 0) {
    throw new Error("--label is not supported when --provider is tensorlake.");
  }

  const sandboxd = createTensorlakeSandboxdSource(argumentsList);
  if (sandboxd.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL) {
    const platform = argumentsList.platform ?? DEFAULT_PLATFORM;
    prepareTensorlakeSandboxdBinary(platform);
  } else if (argumentsList.platform !== undefined) {
    throw new Error("--platform is only supported when --sandboxd-source is local.");
  }

  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.TENSORLAKE,
    tensorlake: {
      apiKey: argumentsList.apiKey,
    },
  });

  console.log(`Registering Tensorlake sandbox image ${argumentsList.outputImageRef}.`);
  const image = await builder.ensureBaseImage({
    source: {
      kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
      contextPath: REPO_ROOT,
      imageId: argumentsList.outputImageRef,
      sandboxd,
    },
  });

  console.log(`Tensorlake sandbox image is ready: ${image.imageId}.`);
}

async function buildE2BBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  if (argumentsList.sourceImageRef === undefined) {
    throw new Error("--source-image-ref is required when --provider is e2b.");
  }

  if (argumentsList.apiKey === undefined) {
    throw new Error("--api-key is required when --provider is e2b.");
  }

  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.E2B,
    e2b: {
      apiKey: argumentsList.apiKey,
      ...(argumentsList.cpuCount === undefined ? {} : { cpuCount: argumentsList.cpuCount }),
      ...(argumentsList.domain === undefined ? {} : { domain: argumentsList.domain }),
      ...(argumentsList.memoryMb === undefined ? {} : { memoryMb: argumentsList.memoryMb }),
    },
  });

  console.log(`Ensuring E2B template for ${argumentsList.sourceImageRef}.`);
  const image = await builder.ensureBaseImage({
    source: {
      kind: SandboxBaseImageSourceKinds.IMAGE,
      imageId: argumentsList.sourceImageRef,
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

  if (argumentsList.provider === SandboxProvider.TENSORLAKE) {
    await buildTensorlakeBaseImage(argumentsList);
    return;
  }

  throw new Error("Unsupported sandbox provider.");
}

await main();
