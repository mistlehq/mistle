import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SandboxBaseImagePublishModes,
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  createSandboxBaseImageBuilder,
} from "../../packages/sandbox/src/index.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_REPOSITORY = "ghcr.io/mistlehq/sandbox-base";
const DEFAULT_PLATFORM = "linux/amd64";
const SANDBOX_BASE_DOCKERFILE_PATH = "packages/sandboxd/Dockerfile";
const SANDBOX_BASE_TARGET = "sandbox-base";
const SANDBOX_BASE_SYSTEM_TESTS_TARGET = "sandbox-base-system-tests";

type ParsedCliArguments = {
  additionalOutputImageRefs: string[];
  apiKey?: string;
  domain?: string;
  labels: Record<string, string>;
  memoryMb?: number;
  outputImageRef?: string;
  platform: string;
  provider: SandboxProvider;
  publishMode: "load" | "push";
  repository: string;
  sourceImageRef?: string;
  tag?: string;
  target: string;
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
  if (value === SandboxProvider.DOCKER || value === SandboxProvider.E2B) {
    return value;
  }

  throw new Error(`--provider must be ${SandboxProvider.DOCKER} or ${SandboxProvider.E2B}.`);
}

function parsePublishMode(value: string): "load" | "push" {
  if (value === SandboxBaseImagePublishModes.LOAD || value === SandboxBaseImagePublishModes.PUSH) {
    return value;
  }

  throw new Error("--publish-mode must be load or push.");
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
  let platform = DEFAULT_PLATFORM;
  let provider: SandboxProvider | undefined;
  let publishMode: "load" | "push" = SandboxBaseImagePublishModes.PUSH;
  let repository = DEFAULT_REPOSITORY;
  let sourceImageRef: string | undefined;
  let tag: string | undefined;
  let target = SANDBOX_BASE_TARGET;

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

  if (platform.trim().length === 0) {
    throw new Error("--platform must not be empty.");
  }

  if (target !== SANDBOX_BASE_TARGET && target !== SANDBOX_BASE_SYSTEM_TESTS_TARGET) {
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
    platform,
    provider,
    publishMode,
    repository,
    target,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(cpuCount === undefined ? {} : { cpuCount }),
    ...(domain === undefined ? {} : { domain }),
    ...(memoryMb === undefined ? {} : { memoryMb }),
    ...(outputImageRef === undefined ? {} : { outputImageRef }),
    ...(sourceImageRef === undefined ? {} : { sourceImageRef }),
    ...(tag === undefined ? {} : { tag }),
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

async function buildDockerBaseImage(argumentsList: ParsedCliArguments): Promise<void> {
  const gitHeadSha = readGitHeadSha();
  const tag = argumentsList.tag ?? createDevTag(gitHeadSha);
  const outputImageRef = argumentsList.outputImageRef ?? `${argumentsList.repository}:${tag}`;
  const builder = createSandboxBaseImageBuilder({
    provider: SandboxProvider.DOCKER,
  });

  console.log(`Building ${outputImageRef}`);
  console.log(`Source HEAD: ${gitHeadSha}`);
  console.log(`Platform: ${argumentsList.platform}`);
  console.log(`Target: ${argumentsList.target}`);

  await builder.buildBaseImage({
    platform: argumentsList.platform,
    source: {
      kind: SandboxBaseImageSourceKinds.DOCKERFILE,
      additionalImageIds: argumentsList.additionalOutputImageRefs,
      contextPath: REPO_ROOT,
      dockerfilePath: SANDBOX_BASE_DOCKERFILE_PATH,
      imageId: outputImageRef,
      labels: argumentsList.labels,
      publishMode: argumentsList.publishMode,
      target: argumentsList.target,
    },
  });

  console.log(`Built ${outputImageRef}`);
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
  const image = await builder.buildBaseImage({
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

  throw new Error("Unsupported sandbox provider.");
}

await main();
