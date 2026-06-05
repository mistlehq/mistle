import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const packageRootPath = path.resolve(scriptDirectoryPath, "..");
const repositoryRootPath = path.resolve(packageRootPath, "..", "..");
const dockerfilePath = path.join(packageRootPath, "Dockerfile.test");
const dockerfileHash = createDockerfileHash(dockerfilePath);
const defaultImageTag = `mistle/sandboxd-test-runner:${dockerfileHash}`;
const defaultCacheKey = `mistle-sandboxd-test-runner-${dockerfileHash}`;
const imageTag = process.env.MISTLE_SANDBOXD_TEST_IMAGE ?? defaultImageTag;
const buildPolicy = process.env.MISTLE_SANDBOXD_TEST_RUNNER_BUILD_POLICY ?? "if-missing";
const netAdminEnabled = process.env.MISTLE_SANDBOXD_TEST_RUNNER_NET_ADMIN === "1";
const cacheMode = resolveCacheMode();
const cargoArguments = process.argv.slice(2);
const localCacheRootPath = path.join(repositoryRootPath, ".local", "sandboxd-test");
const cargoHomeHostPath = path.join(localCacheRootPath, "cargo-home");
const cargoTargetHostPath = path.join(localCacheRootPath, "target-ubuntu-container");
const tempDirectoryHostPath = path.join(localCacheRootPath, "tmp");
const gitCommonDirectoryPath = readGitPath("rev-parse", "--git-common-dir");
const resolvedGitCommonDirectoryPath = path.resolve(repositoryRootPath, gitCommonDirectoryPath);
const repositoryMountPath = repositoryRootPath;
const packageMountPath = packageRootPath;
const cargoTargetDirectoryPath =
  cacheMode === "path"
    ? path.join(repositoryMountPath, ".local", "sandboxd-test", "target-ubuntu-container")
    : "/target";
const cargoHomeMountPath = "/cargo-home";
const tempDirectoryPath =
  cacheMode === "path" ? path.join(repositoryMountPath, ".local", "sandboxd-test", "tmp") : "/tmp";
const cargoHomeVolumeName =
  process.env.MISTLE_SANDBOXD_TEST_CARGO_HOME_VOLUME ?? `${defaultCacheKey}-cargo-home`;
const cargoTargetVolumeName =
  process.env.MISTLE_SANDBOXD_TEST_TARGET_VOLUME ?? `${defaultCacheKey}-target`;

if (cargoArguments.length === 0) {
  throw new Error("Expected cargo arguments, e.g. `test --locked`.");
}

if (buildPolicy !== "always" && buildPolicy !== "if-missing" && buildPolicy !== "never") {
  throw new Error(
    `Unsupported MISTLE_SANDBOXD_TEST_RUNNER_BUILD_POLICY '${buildPolicy}'. Expected 'always', 'if-missing', or 'never'.`,
  );
}

if (cacheMode === "path") {
  mkdirSync(cargoHomeHostPath, { recursive: true });
  mkdirSync(cargoTargetHostPath, { recursive: true });
  mkdirSync(tempDirectoryHostPath, { recursive: true });
}

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
  ...createCapabilityArguments(),
  ...createEnvironmentArguments({
    CI: process.env.CI,
    CARGO_HOME: cargoHomeMountPath,
    CARGO_TARGET_DIR: cargoTargetDirectoryPath,
    HOME: "/tmp/mistle-home",
    ...readMistleEnvironmentVariables(),
    MISTLE_SANDBOXD_TEST_HOST_GID: hostGid(),
    MISTLE_SANDBOXD_TEST_HOST_UID: hostUid(),
    PATH: "/usr/local/cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
    RUSTUP_HOME: "/usr/local/rustup",
    TMPDIR: tempDirectoryPath,
  }),
  "--volume",
  `${repositoryRootPath}:${repositoryMountPath}`,
  ...createGitMountArguments(),
  ...createCacheVolumeArguments(),
  "--workdir",
  packageMountPath,
  imageTag,
  "bash",
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
    `Sandboxd containerized cargo command failed with exit code ${String(dockerRunResult.status ?? 1)}.`,
  );
}

function createDockerfileHash(dockerfilePath) {
  const dockerfileContents = readFileSync(dockerfilePath, "utf8");
  return createHash("sha256").update(dockerfileContents).digest("hex").slice(0, 12);
}

function resolveCacheMode() {
  const explicitCacheMode = process.env.MISTLE_SANDBOXD_TEST_CACHE_MODE;
  if (explicitCacheMode === "path" || explicitCacheMode === "volume") {
    return explicitCacheMode;
  }

  if (explicitCacheMode !== undefined) {
    throw new Error(
      `Unsupported MISTLE_SANDBOXD_TEST_CACHE_MODE '${explicitCacheMode}'. Expected 'path' or 'volume'.`,
    );
  }

  if (process.env.CI !== undefined) {
    return "path";
  }

  return "volume";
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
      `Sandboxd test runner image '${input.imageTag}' is unavailable and build policy is 'never'.`,
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

function createCapabilityArguments() {
  if (!netAdminEnabled) {
    return [];
  }

  return ["--cap-add", "NET_ADMIN"];
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

function createCacheVolumeArguments() {
  if (cacheMode === "path") {
    return ["--volume", `${cargoHomeHostPath}:${cargoHomeMountPath}`];
  }

  return [
    "--volume",
    `${cargoHomeVolumeName}:${cargoHomeMountPath}`,
    "--volume",
    `${cargoTargetVolumeName}:${cargoTargetDirectoryPath}`,
  ];
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
  return [
    "mkdir -p /tmp/mistle-home",
    `cargo ${quotedArguments}`,
    "status=$?",
    "restore_status=0",
    createRestoreOwnershipCommand(),
    'if [ "$status" -eq 0 ]; then exit "$restore_status"; fi',
    "exit $status",
  ].join("; ");
}

function createRestoreOwnershipCommand() {
  if (cacheMode === "volume") {
    return "true";
  }

  const cacheRootPath = path.join(repositoryMountPath, ".local", "sandboxd-test");
  const quotedCacheRootPath = shellQuote(cacheRootPath);
  return [
    'if [ -n "$MISTLE_SANDBOXD_TEST_HOST_UID" ] && [ -n "$MISTLE_SANDBOXD_TEST_HOST_GID" ]; then',
    `chown -R "$MISTLE_SANDBOXD_TEST_HOST_UID:$MISTLE_SANDBOXD_TEST_HOST_GID" ${quotedCacheRootPath} || restore_status=$?;`,
    "fi",
  ].join(" ");
}

function hostUid() {
  if (typeof process.getuid !== "function") {
    return undefined;
  }

  return String(process.getuid());
}

function hostGid() {
  if (typeof process.getgid !== "function") {
    return undefined;
  }

  return String(process.getgid());
}

function shellQuote(value) {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
