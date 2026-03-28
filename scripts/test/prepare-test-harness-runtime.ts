import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DefaultSandboxBaseImageBuild,
  type PreparedTestHarnessDockerAppName,
  PreparedTestHarnessDockerAppBuilds,
  type PreparedTestHarnessRuntime,
  type PreparedTestHarnessRuntimeFingerprint,
  readPreparedTestHarnessRuntime,
  resolvePreparedTestHarnessRuntimePath,
  writePreparedTestHarnessRuntime,
} from "../../packages/test-harness/src/system/prepared-runtime.ts";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../..");
const NodeToolchainImage = "node:25-bookworm-slim";

type ContextFileEntry =
  | {
      absolutePath: string;
      relativePath: string;
      mode: number;
      size: number;
      kind: "file";
    }
  | {
      absolutePath: string;
      relativePath: string;
      mode: number;
      size: number;
      kind: "symlink";
      linkTarget: string;
    };

type CollectedContextFiles = {
  docker: readonly ContextFileEntry[];
  sea: readonly ContextFileEntry[];
};

function createPreparedImageName(input: {
  appName: PreparedTestHarnessDockerAppName;
  buildContextHostPath: string;
}): string {
  const digest = createHash("sha256")
    .update(`${resolve(input.buildContextHostPath)}:${input.appName}`)
    .digest("hex")
    .slice(0, 20);
  return `mistle-test-target-${digest}`;
}

function createPreparedRuntime(buildContextHostPath: string): PreparedTestHarnessRuntime {
  return {
    schemaVersion: 2,
    provider: "docker",
    fingerprint: {
      architecture: process.arch,
      dockerContextFingerprint: "",
      seaContextFingerprint: "",
      sandboxBaseImageFingerprint: "",
      appImageFingerprints: {
        controlPlaneApi: "",
        controlPlaneWorker: "",
        dataPlaneApi: "",
        dataPlaneGateway: "",
        dataPlaneWorker: "",
        tokenizerProxy: "",
      },
    },
    sandboxBaseImage: {
      localReference: DefaultSandboxBaseImageBuild.localReference,
      repositoryPath: DefaultSandboxBaseImageBuild.repositoryPath,
    },
    appImages: {
      controlPlaneApi: createPreparedImageName({
        appName: "controlPlaneApi",
        buildContextHostPath,
      }),
      controlPlaneWorker: createPreparedImageName({
        appName: "controlPlaneWorker",
        buildContextHostPath,
      }),
      dataPlaneApi: createPreparedImageName({
        appName: "dataPlaneApi",
        buildContextHostPath,
      }),
      dataPlaneGateway: createPreparedImageName({
        appName: "dataPlaneGateway",
        buildContextHostPath,
      }),
      dataPlaneWorker: createPreparedImageName({
        appName: "dataPlaneWorker",
        buildContextHostPath,
      }),
      tokenizerProxy: createPreparedImageName({
        appName: "tokenizerProxy",
        buildContextHostPath,
      }),
    },
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function splitRelativePath(relativePath: string): string[] {
  return relativePath.length === 0 ? [] : relativePath.split("/");
}

function isPathWithin(relativePath: string, basePath: string): boolean {
  return relativePath === basePath || relativePath.startsWith(`${basePath}/`);
}

function hasAnySegment(relativePath: string, candidates: readonly string[]): boolean {
  const segments = splitRelativePath(relativePath);
  return candidates.some((candidate) => segments.includes(candidate));
}

function isAllowedDockerDistPath(relativePath: string): boolean {
  const segments = splitRelativePath(relativePath);
  const firstSegment = segments[0];

  if (firstSegment !== "apps" && firstSegment !== "packages") {
    return false;
  }

  return segments.includes("dist");
}

function shouldTraverseSeaDirectory(relativePath: string): boolean {
  if (relativePath.length === 0) {
    return true;
  }
  if (hasAnySegment(relativePath, [".git", ".local", ".turbo", "node_modules"])) {
    return false;
  }
  if (isPathWithin(relativePath, "apps/sandbox-runtime/dist-sea")) {
    return false;
  }

  return true;
}

function shouldIncludeSeaFile(relativePath: string): boolean {
  if (hasAnySegment(relativePath, [".git", ".local", ".turbo", "node_modules"])) {
    return false;
  }
  if (isPathWithin(relativePath, "apps/sandbox-runtime/dist-sea")) {
    return false;
  }

  return true;
}

function shouldTraverseDockerDirectory(relativePath: string): boolean {
  if (relativePath.length === 0) {
    return true;
  }
  if (
    relativePath === ".git" ||
    relativePath === ".local" ||
    relativePath === ".pkgrep" ||
    hasAnySegment(relativePath, [".turbo", "coverage", "node_modules", "test-results"])
  ) {
    return false;
  }
  if (isPathWithin(relativePath, "apps/sandbox-runtime/dist-sea")) {
    return false;
  }

  const segments = splitRelativePath(relativePath);
  const lastSegment = segments.at(-1);
  if (lastSegment === "dist" && !isAllowedDockerDistPath(relativePath)) {
    return false;
  }

  return true;
}

function shouldIncludeDockerFile(relativePath: string): boolean {
  if (
    relativePath === ".DS_Store" ||
    relativePath.endsWith(".log") ||
    relativePath === ".git" ||
    relativePath === ".local" ||
    relativePath === ".pkgrep" ||
    hasAnySegment(relativePath, [".turbo", "coverage", "node_modules", "test-results"])
  ) {
    return false;
  }
  if (isPathWithin(relativePath, "apps/sandbox-runtime/dist-sea")) {
    return false;
  }

  const segments = splitRelativePath(relativePath);
  if (segments.includes(".DS_Store")) {
    return false;
  }
  if (segments.includes("dist") && !isAllowedDockerDistPath(relativePath)) {
    return false;
  }

  return true;
}

async function createContextFileEntry(relativePath: string): Promise<ContextFileEntry> {
  const absolutePath = resolve(RepositoryRootPath, relativePath);
  const fileStats = await lstat(absolutePath);

  if (fileStats.isSymbolicLink()) {
    return {
      absolutePath,
      relativePath,
      mode: fileStats.mode,
      size: fileStats.size,
      kind: "symlink",
      linkTarget: await readlink(absolutePath),
    };
  }

  if (!fileStats.isFile()) {
    throw new Error(`Unsupported path in prepared runtime context: ${absolutePath}`);
  }

  return {
    absolutePath,
    relativePath,
    mode: fileStats.mode,
    size: fileStats.size,
    kind: "file",
  };
}

async function collectContextFiles(): Promise<CollectedContextFiles> {
  const dockerFiles: ContextFileEntry[] = [];
  const seaFiles: ContextFileEntry[] = [];

  async function walk(relativeDirectoryPath: string): Promise<void> {
    const absoluteDirectoryPath = resolve(RepositoryRootPath, relativeDirectoryPath);
    const directoryEntries = await readdir(absoluteDirectoryPath, { withFileTypes: true });
    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const directoryEntry of directoryEntries) {
      const relativePath =
        relativeDirectoryPath.length === 0
          ? directoryEntry.name
          : `${relativeDirectoryPath}/${directoryEntry.name}`;

      if (directoryEntry.isDirectory()) {
        const shouldWalkSea = shouldTraverseSeaDirectory(relativePath);
        const shouldWalkDocker = shouldTraverseDockerDirectory(relativePath);
        if (!shouldWalkSea && !shouldWalkDocker) {
          continue;
        }

        await walk(relativePath);
        continue;
      }

      if (!directoryEntry.isFile() && !directoryEntry.isSymbolicLink()) {
        continue;
      }

      const includeSea = shouldIncludeSeaFile(relativePath);
      const includeDocker = shouldIncludeDockerFile(relativePath);
      if (!includeSea && !includeDocker) {
        continue;
      }

      const fileEntry = await createContextFileEntry(relativePath);
      if (includeSea) {
        seaFiles.push(fileEntry);
      }
      if (includeDocker) {
        dockerFiles.push(fileEntry);
      }
    }
  }

  await walk("");
  dockerFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  seaFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    docker: dockerFiles,
    sea: seaFiles,
  };
}

async function hashContextFiles(files: readonly ContextFileEntry[]): Promise<string> {
  const hash = createHash("sha256");

  for (const file of files) {
    hash.update(`path:${file.relativePath}\n`);
    hash.update(`mode:${file.mode.toString(8)}\n`);
    hash.update(`size:${String(file.size)}\n`);

    if (file.kind === "symlink") {
      hash.update(`link:${file.linkTarget}\n`);
    } else {
      hash.update(await readFile(file.absolutePath));
    }

    hash.update("\n--file-boundary--\n");
  }

  return hash.digest("hex");
}

function hashString(parts: readonly string[]): string {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(part);
  }

  return hash.digest("hex");
}

async function createPreparedRuntimeFingerprint(): Promise<PreparedTestHarnessRuntimeFingerprint> {
  const contextFiles = await collectContextFiles();
  const seaFileFingerprint = await hashContextFiles(contextFiles.sea);
  const dockerFileFingerprint = await hashContextFiles(contextFiles.docker);
  const sandboxDockerfileContents = await readFile(
    resolve(RepositoryRootPath, DefaultSandboxBaseImageBuild.dockerfilePath),
    "utf8",
  );

  const seaContextFingerprint = hashString([
    "sea-context\n",
    `arch:${process.arch}\n`,
    `platform:${process.platform}\n`,
    `toolchain:${NodeToolchainImage}\n`,
    seaFileFingerprint,
  ]);
  const dockerContextFingerprint = hashString(["docker-context\n", dockerFileFingerprint]);

  return {
    architecture: process.arch,
    dockerContextFingerprint,
    seaContextFingerprint,
    sandboxBaseImageFingerprint: hashString([
      "sandbox-base\n",
      seaContextFingerprint,
      "\n",
      sandboxDockerfileContents,
    ]),
    appImageFingerprints: {
      controlPlaneApi: hashString(["control-plane-api-test-runtime\n", dockerContextFingerprint]),
      controlPlaneWorker: hashString([
        "control-plane-worker-test-runtime\n",
        dockerContextFingerprint,
      ]),
      dataPlaneApi: hashString(["data-plane-api-test-runtime\n", dockerContextFingerprint]),
      dataPlaneGateway: hashString(["data-plane-gateway-test-runtime\n", dockerContextFingerprint]),
      dataPlaneWorker: hashString(["data-plane-worker-test-runtime\n", dockerContextFingerprint]),
      tokenizerProxy: hashString(["tokenizer-proxy-test-runtime\n", dockerContextFingerprint]),
    },
  };
}

function preparedRuntimeFingerprintsEqual(
  left: PreparedTestHarnessRuntimeFingerprint,
  right: PreparedTestHarnessRuntimeFingerprint,
): boolean {
  return (
    left.architecture === right.architecture &&
    left.dockerContextFingerprint === right.dockerContextFingerprint &&
    left.seaContextFingerprint === right.seaContextFingerprint &&
    left.sandboxBaseImageFingerprint === right.sandboxBaseImageFingerprint &&
    left.appImageFingerprints.controlPlaneApi === right.appImageFingerprints.controlPlaneApi &&
    left.appImageFingerprints.controlPlaneWorker ===
      right.appImageFingerprints.controlPlaneWorker &&
    left.appImageFingerprints.dataPlaneApi === right.appImageFingerprints.dataPlaneApi &&
    left.appImageFingerprints.dataPlaneGateway === right.appImageFingerprints.dataPlaneGateway &&
    left.appImageFingerprints.dataPlaneWorker === right.appImageFingerprints.dataPlaneWorker &&
    left.appImageFingerprints.tokenizerProxy === right.appImageFingerprints.tokenizerProxy
  );
}

function preparedRuntimeReferencesEqual(
  left: PreparedTestHarnessRuntime,
  right: PreparedTestHarnessRuntime,
): boolean {
  return (
    left.provider === right.provider &&
    left.sandboxBaseImage.localReference === right.sandboxBaseImage.localReference &&
    left.sandboxBaseImage.repositoryPath === right.sandboxBaseImage.repositoryPath &&
    left.appImages.controlPlaneApi === right.appImages.controlPlaneApi &&
    left.appImages.controlPlaneWorker === right.appImages.controlPlaneWorker &&
    left.appImages.dataPlaneApi === right.appImages.dataPlaneApi &&
    left.appImages.dataPlaneGateway === right.appImages.dataPlaneGateway &&
    left.appImages.dataPlaneWorker === right.appImages.dataPlaneWorker &&
    left.appImages.tokenizerProxy === right.appImages.tokenizerProxy
  );
}

function dockerImageExists(imageName: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", imageName], {
      cwd: RepositoryRootPath,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function preparedRuntimeManifestExists(buildContextHostPath: string): Promise<boolean> {
  try {
    await stat(resolvePreparedTestHarnessRuntimePath(buildContextHostPath));
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function readExistingPreparedRuntime(
  buildContextHostPath: string,
): Promise<PreparedTestHarnessRuntime | undefined> {
  if (!(await preparedRuntimeManifestExists(buildContextHostPath))) {
    return undefined;
  }

  try {
    return await readPreparedTestHarnessRuntime(buildContextHostPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Ignoring stale prepared test-harness runtime manifest at ${resolvePreparedTestHarnessRuntimePath(buildContextHostPath)}: ${message}`,
    );
    return undefined;
  }
}

function allPreparedRuntimeImagesExist(runtime: PreparedTestHarnessRuntime): boolean {
  return (
    dockerImageExists(runtime.sandboxBaseImage.localReference) &&
    dockerImageExists(runtime.appImages.controlPlaneApi) &&
    dockerImageExists(runtime.appImages.controlPlaneWorker) &&
    dockerImageExists(runtime.appImages.dataPlaneApi) &&
    dockerImageExists(runtime.appImages.dataPlaneGateway) &&
    dockerImageExists(runtime.appImages.dataPlaneWorker) &&
    dockerImageExists(runtime.appImages.tokenizerProxy)
  );
}

function runCommand(command: string, args: readonly string[]): void {
  execFileSync(command, [...args], {
    cwd: RepositoryRootPath,
    env: {
      ...process.env,
      DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT ?? "1",
    },
    stdio: "inherit",
  });
}

async function buildSandboxBaseImage(): Promise<void> {
  runCommand("pnpm", ["build:sandbox-runtime:sea:linux"]);
  runCommand("docker", [
    "build",
    "--target",
    DefaultSandboxBaseImageBuild.dockerTarget,
    "-f",
    DefaultSandboxBaseImageBuild.dockerfilePath,
    "-t",
    DefaultSandboxBaseImageBuild.localReference,
    ".",
  ]);
}

function shouldBuildSandboxBaseImage(input: {
  existingRuntime: PreparedTestHarnessRuntime | undefined;
  runtime: PreparedTestHarnessRuntime;
}): boolean {
  if (!dockerImageExists(input.runtime.sandboxBaseImage.localReference)) {
    return true;
  }
  if (input.existingRuntime === undefined) {
    return true;
  }

  return (
    input.existingRuntime.fingerprint.sandboxBaseImageFingerprint !==
    input.runtime.fingerprint.sandboxBaseImageFingerprint
  );
}

function shouldBuildAppImage(input: {
  appName: PreparedTestHarnessDockerAppName;
  existingRuntime: PreparedTestHarnessRuntime | undefined;
  runtime: PreparedTestHarnessRuntime;
}): boolean {
  const currentImageName = input.runtime.appImages[input.appName];
  if (!dockerImageExists(currentImageName)) {
    return true;
  }
  if (input.existingRuntime === undefined) {
    return true;
  }

  return (
    input.existingRuntime.fingerprint.appImageFingerprints[input.appName] !==
    input.runtime.fingerprint.appImageFingerprints[input.appName]
  );
}

function createRuntimeWithFingerprint(input: {
  buildContextHostPath: string;
  fingerprint: PreparedTestHarnessRuntimeFingerprint;
}): PreparedTestHarnessRuntime {
  const runtime = createPreparedRuntime(input.buildContextHostPath);
  runtime.fingerprint = input.fingerprint;
  return runtime;
}

async function main(): Promise<void> {
  const currentFingerprint = await createPreparedRuntimeFingerprint();
  const runtime = createRuntimeWithFingerprint({
    buildContextHostPath: RepositoryRootPath,
    fingerprint: currentFingerprint,
  });
  const existingRuntime = await readExistingPreparedRuntime(RepositoryRootPath);

  if (
    existingRuntime !== undefined &&
    preparedRuntimeFingerprintsEqual(existingRuntime.fingerprint, currentFingerprint) &&
    preparedRuntimeReferencesEqual(existingRuntime, runtime) &&
    allPreparedRuntimeImagesExist(runtime)
  ) {
    console.info(
      `Prepared test-harness runtime is up to date: ${resolvePreparedTestHarnessRuntimePath(RepositoryRootPath)}`,
    );
    return;
  }

  if (
    shouldBuildSandboxBaseImage({
      existingRuntime,
      runtime,
    })
  ) {
    console.info("Rebuilding prepared sandbox base image.");
    await buildSandboxBaseImage();
  } else {
    console.info("Reusing prepared sandbox base image.");
  }

  for (const build of PreparedTestHarnessDockerAppBuilds) {
    if (
      shouldBuildAppImage({
        appName: build.appName,
        existingRuntime,
        runtime,
      })
    ) {
      console.info(`Rebuilding prepared app image for ${build.appName}.`);
      runCommand("docker", [
        "build",
        "--pull=false",
        "--target",
        build.dockerTarget,
        "-f",
        build.dockerfileRelativePath,
        "-t",
        runtime.appImages[build.appName],
        ".",
      ]);
    } else {
      console.info(`Reusing prepared app image for ${build.appName}.`);
    }
  }

  const runtimePath = await writePreparedTestHarnessRuntime({
    buildContextHostPath: RepositoryRootPath,
    runtime,
  });

  console.info(`Prepared test-harness runtime manifest: ${runtimePath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
