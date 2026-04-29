import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const packageRootPath = path.resolve(scriptDirectoryPath, "..");
const repositoryRootPath = path.resolve(packageRootPath, "..", "..");
const dockerfilePath = path.join(packageRootPath, "Dockerfile.test");
const defaultImageTag = createDefaultImageTag(dockerfilePath);
const imageTag = process.env.MISTLE_COMMIT_SIGN_TEST_IMAGE ?? defaultImageTag;
const buildPolicy = process.env.MISTLE_COMMIT_SIGN_TEST_RUNNER_BUILD_POLICY ?? "if-missing";
const cargoArguments = process.argv.slice(2);
const localCacheRootPath = path.join(repositoryRootPath, ".local", "commit-sign-test");
const cargoHomeHostPath = path.join(localCacheRootPath, "cargo-home");
const tempDirectoryHostPath = path.join(localCacheRootPath, "tmp");
const gitCommonDirectoryPath = readGitPath("rev-parse", "--git-common-dir");
const resolvedGitCommonDirectoryPath = path.resolve(repositoryRootPath, gitCommonDirectoryPath);
const repositoryMountPath = repositoryRootPath;
const packageMountPath = packageRootPath;
const cargoTargetDirectoryPath = path.join(
  repositoryMountPath,
  ".local",
  "commit-sign-test",
  "target-alpine-container",
);

if (cargoArguments.length === 0) {
  throw new Error("Expected cargo arguments, e.g. `test --locked`.");
}

if (buildPolicy !== "always" && buildPolicy !== "if-missing" && buildPolicy !== "never") {
  throw new Error(
    `Unsupported MISTLE_COMMIT_SIGN_TEST_RUNNER_BUILD_POLICY '${buildPolicy}'. Expected 'always', 'if-missing', or 'never'.`,
  );
}

mkdirSync(cargoHomeHostPath, { recursive: true });
mkdirSync(tempDirectoryHostPath, { recursive: true });

if (shouldBuildImage({ imageTag, buildPolicy })) {
  execFileSync(
    "docker",
    ["build", "--pull=false", "--tag", imageTag, "--file", dockerfilePath, packageRootPath],
    {
      cwd: repositoryRootPath,
      stdio: "inherit",
    },
  );
}

const dockerRunArguments = [
  "run",
  "--rm",
  ...createUserArguments(),
  ...createEnvironmentArguments({
    CI: process.env.CI,
    CARGO_HOME: "/cargo-home",
    CARGO_TARGET_DIR: cargoTargetDirectoryPath,
    HOME: "/tmp/mistle-home",
    PATH: "/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    RUSTUP_HOME: "/usr/local/rustup",
    TMPDIR: path.join(repositoryMountPath, ".local", "commit-sign-test", "tmp"),
    ...readMistleEnvironmentVariables(),
  }),
  "--volume",
  `${repositoryRootPath}:${repositoryMountPath}`,
  ...createGitMountArguments(),
  "--volume",
  `${cargoHomeHostPath}:/cargo-home`,
  "--workdir",
  packageMountPath,
  imageTag,
  "sh",
  "-c",
  createCargoCommand(),
];

const dockerRunResult = spawnSync("docker", dockerRunArguments, {
  cwd: repositoryRootPath,
  stdio: "inherit",
});

if (dockerRunResult.error) {
  throw dockerRunResult.error;
}

if (dockerRunResult.status !== 0) {
  throw new Error(
    `Commit-sign containerized cargo command failed with exit code ${String(dockerRunResult.status ?? 1)}.`,
  );
}

function createDefaultImageTag(dockerfilePath) {
  const dockerfileContents = readFileSync(dockerfilePath, "utf8");
  const hash = createHash("sha256").update(dockerfileContents).digest("hex").slice(0, 12);
  return `mistle/commit-sign-test-runner:${hash}`;
}

function readGitPath(...argumentsList) {
  return execFileSync("git", argumentsList, {
    cwd: repositoryRootPath,
    encoding: "utf8",
  }).trim();
}

function shouldBuildImage(input) {
  if (input.buildPolicy === "always") {
    return true;
  }

  const imageExists = dockerImageExists(input.imageTag);
  if (input.buildPolicy === "if-missing") {
    return !imageExists;
  }

  if (!imageExists) {
    throw new Error(
      `Commit-sign test runner image '${input.imageTag}' is unavailable and build policy is 'never'.`,
    );
  }

  return false;
}

function dockerImageExists(imageTag) {
  try {
    execFileSync("docker", ["image", "inspect", imageTag], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function createUserArguments() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }

  return ["--user", `${String(process.getuid())}:${String(process.getgid())}`];
}

function createGitMountArguments() {
  if (
    resolvedGitCommonDirectoryPath === repositoryRootPath ||
    resolvedGitCommonDirectoryPath.startsWith(`${repositoryRootPath}${path.sep}`)
  ) {
    return [];
  }

  return ["--volume", `${resolvedGitCommonDirectoryPath}:${resolvedGitCommonDirectoryPath}`];
}

/**
 * @param {Record<string, string | undefined>} environment
 */
function createEnvironmentArguments(environment) {
  const argumentsList = [];

  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      continue;
    }
    argumentsList.push("--env", `${key}=${value}`);
  }

  return argumentsList;
}

function readMistleEnvironmentVariables() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => {
      return key.startsWith("MISTLE_") && value !== undefined;
    }),
  );
}

function createCargoCommand() {
  const quotedArguments = cargoArguments.map((argument) => shellQuote(argument)).join(" ");
  return `mkdir -p /tmp/mistle-home && cargo ${quotedArguments}`;
}

function shellQuote(value) {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
