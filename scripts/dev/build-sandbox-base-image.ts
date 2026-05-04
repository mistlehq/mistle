import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_REPOSITORY = "ghcr.io/mistlehq/sandbox-base";
const DEFAULT_PLATFORM = "linux/amd64";
const SANDBOX_BASE_DOCKERFILE_PATH = "packages/sandboxd/Dockerfile";
const SANDBOX_BASE_TARGET = "sandbox-base";

type ParsedCliArguments = {
  platform: string;
  repository: string;
  tag: string | null;
};

function printUsage(): void {
  console.log(`Usage: pnpm run dev:sandbox-base:push [options]

Builds and pushes the sandbox base image to GHCR.

Options:
  --repository <ref>  Image repository (default: ${DEFAULT_REPOSITORY})
  --platform <value>  Docker platform (default: ${DEFAULT_PLATFORM})
  --tag <tag>         Explicit tag. Must start with dev-
  --help             Show this message

Without --tag, the script generates a unique dev-<hash> tag.
`);
}

function requireFlagValue(argv: readonly string[], index: number, flagName: string): string {
  const nextValue = argv[index + 1];
  if (nextValue === undefined || nextValue.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return nextValue;
}

function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  let repository = DEFAULT_REPOSITORY;
  let platform = DEFAULT_PLATFORM;
  let tag: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--repository") {
      repository = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--platform") {
      platform = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--tag") {
      tag = requireFlagValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (repository.trim().length === 0) {
    throw new Error("--repository must not be empty.");
  }

  if (platform.trim().length === 0) {
    throw new Error("--platform must not be empty.");
  }

  if (tag !== null && !tag.startsWith("dev-")) {
    throw new Error("--tag must start with dev-.");
  }

  return {
    platform,
    repository,
    tag,
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

function runDockerBuildAndPush(imageRef: string, platform: string): void {
  const result = spawnSync(
    "docker",
    [
      "buildx",
      "build",
      "--platform",
      platform,
      "--file",
      SANDBOX_BASE_DOCKERFILE_PATH,
      "--target",
      SANDBOX_BASE_TARGET,
      "--tag",
      imageRef,
      "--push",
      ".",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`Docker buildx push failed with exit code ${String(result.status)}.`);
  }
}

function inspectImage(imageRef: string): string {
  return execFileSync("docker", ["buildx", "imagetools", "inspect", imageRef], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function main(): void {
  const parsedArguments = parseCliArguments(process.argv.slice(2));
  const gitHeadSha = readGitHeadSha();
  const tag = parsedArguments.tag ?? createDevTag(gitHeadSha);
  const imageRef = `${parsedArguments.repository}:${tag}`;

  console.log(`Building ${imageRef}`);
  console.log(`Source HEAD: ${gitHeadSha}`);
  console.log(`Platform: ${parsedArguments.platform}`);

  runDockerBuildAndPush(imageRef, parsedArguments.platform);

  console.log(`Pushed ${imageRef}`);
  process.stdout.write(inspectImage(imageRef));
}

main();
