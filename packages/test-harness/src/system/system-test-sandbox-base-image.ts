import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { systemClock, systemSleeper } from "@mistle/time";

import { MISTLE_TEST_COORDINATOR_DIR_ENV } from "../environment/runner-pool-session.js";
import {
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV,
  readPrepublishedSystemTestSandboxBaseImageRef,
} from "./system-test-sandbox-base-image-source.js";
export {
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV,
  resolveSystemTestSandboxBaseImageSource,
  type SystemTestSandboxBaseImageSource,
} from "./system-test-sandbox-base-image-source.js";

const execFileAsync = promisify(execFile);
const DefaultBuildContextHostPath = fileURLToPath(new URL("../../../..", import.meta.url));

const SandboxBaseImageRepository = "ghcr.io/mistlehq/sandbox-base";
const SandboxBaseImagePlatform = "linux/amd64";
const SandboxBaseImageTarget = "sandbox-base-system-tests";
const SandboxBaseImageHashInputs = [
  ".dockerignore",
  "packages/sandboxd",
  "tests/system/fixtures/vite-dev-server",
];
const SandboxBaseImageLockPollIntervalMs = 1_000;
const SandboxBaseImageLockTimeoutMs = 30 * 60_000;

let systemTestSandboxBaseImageRefPromise: Promise<string> | undefined;

export async function getSystemTestSandboxBaseImageRef(): Promise<string> {
  if (systemTestSandboxBaseImageRefPromise !== undefined) {
    return systemTestSandboxBaseImageRefPromise;
  }

  systemTestSandboxBaseImageRefPromise = resolveSystemTestSandboxBaseImageRef();
  return systemTestSandboxBaseImageRefPromise;
}

export async function resolveSystemTestSandboxBaseImageRef(): Promise<string> {
  const prepublishedImageRef = readPrepublishedSystemTestSandboxBaseImageRef();
  if (prepublishedImageRef !== undefined) {
    await verifySystemTestSandboxBaseImageExists(prepublishedImageRef);
    return prepublishedImageRef;
  }

  const tag = `sys-${await createSandboxBaseImageFingerprint()}`;
  const imageRef = `${SandboxBaseImageRepository}:${tag}`;
  if (await ghcrImageExists(imageRef)) {
    return imageRef;
  }

  return withSystemTestSandboxBaseImageLock(tag, async () => {
    if (await ghcrImageExists(imageRef)) {
      return imageRef;
    }

    await runCommand({
      command: "pnpm",
      args: [
        "run",
        "dev:sandbox-base:push:docker",
        "--repository",
        SandboxBaseImageRepository,
        "--platform",
        SandboxBaseImagePlatform,
        "--target",
        SandboxBaseImageTarget,
        "--tag",
        tag,
      ],
      cwd: DefaultBuildContextHostPath,
      env: {},
    });

    return imageRef;
  });
}

async function verifySystemTestSandboxBaseImageExists(imageRef: string): Promise<void> {
  if (await ghcrImageExists(imageRef)) {
    return;
  }

  throw new Error(
    `${MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV} points to '${imageRef}', but that image does not exist in GHCR.`,
  );
}

async function ghcrImageExists(imageRef: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["buildx", "imagetools", "inspect", imageRef], {
      cwd: DefaultBuildContextHostPath,
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function createSandboxBaseImageFingerprint(): Promise<string> {
  const trackedFiles = await readTrackedSandboxBaseImageFiles();
  const hash = createHash("sha256");
  hash.update(SandboxBaseImageTarget);
  hash.update("\0");

  for (const filePath of trackedFiles) {
    hash.update(filePath);
    hash.update("\0");
    hash.update(await readFile(new URL(`../../../../${filePath}`, import.meta.url)));
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 24);
}

async function readTrackedSandboxBaseImageFiles(): Promise<readonly string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "--", ...SandboxBaseImageHashInputs], {
    cwd: DefaultBuildContextHostPath,
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

async function withSystemTestSandboxBaseImageLock<T>(
  tag: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockRootDirectoryPath = join(
    readSystemTestCoordinatorDirectoryPath(),
    "sandbox-base-images",
  );
  const lockDirectoryPath = join(lockRootDirectoryPath, `${tag}.lock`);
  const ownerFilePath = join(lockDirectoryPath, "owner.json");
  const deadline = systemClock.nowMs() + SandboxBaseImageLockTimeoutMs;

  await mkdir(lockRootDirectoryPath, {
    recursive: true,
  });

  while (systemClock.nowMs() < deadline) {
    try {
      await mkdir(lockDirectoryPath);
      await writeFile(
        ownerFilePath,
        JSON.stringify({
          pid: process.pid,
          createdAt: systemClock.nowMs(),
          tag,
        }),
        "utf8",
      );

      try {
        return await callback();
      } finally {
        await rm(lockDirectoryPath, {
          recursive: true,
          force: true,
        });
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      await removeStaleSystemTestSandboxBaseImageLock({
        lockDirectoryPath,
        ownerFilePath,
      });
      await systemSleeper.sleep(SandboxBaseImageLockPollIntervalMs);
    }
  }

  throw new Error(
    `Timed out acquiring system test sandbox base image lock '${lockDirectoryPath}'.`,
  );
}

export function readSystemTestCoordinatorDirectoryPath(): string {
  const coordinatorDir = process.env[MISTLE_TEST_COORDINATOR_DIR_ENV];
  if (coordinatorDir !== undefined && coordinatorDir.length > 0) {
    return coordinatorDir;
  }

  return join(tmpdir(), "mistle-test-harness", "system-runtime");
}

async function removeStaleSystemTestSandboxBaseImageLock(input: {
  lockDirectoryPath: string;
  ownerFilePath: string;
}): Promise<void> {
  let rawOwner: string;
  try {
    rawOwner = await readFile(input.ownerFilePath, "utf8");
  } catch (error) {
    if (
      isNodeErrorCode(error, "ENOENT") &&
      (await isLockDirectoryExpired(input.lockDirectoryPath))
    ) {
      await rm(input.lockDirectoryPath, {
        recursive: true,
        force: true,
      });
    }
    return;
  }

  const ownerPid = readLockOwnerPid(rawOwner, input.ownerFilePath);
  if (isProcessAlive(ownerPid)) {
    return;
  }

  await rm(input.lockDirectoryPath, {
    recursive: true,
    force: true,
  });
}

async function isLockDirectoryExpired(lockDirectoryPath: string): Promise<boolean> {
  try {
    const details = await stat(lockDirectoryPath);
    return systemClock.nowMs() - details.mtimeMs > SandboxBaseImageLockTimeoutMs;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

function readLockOwnerPid(rawOwner: string, ownerFilePath: string): number {
  let owner: unknown;
  try {
    owner = JSON.parse(rawOwner);
  } catch (error) {
    throw new Error(`System test sandbox base image lock owner '${ownerFilePath}' is invalid.`, {
      cause: error,
    });
  }

  if (
    typeof owner !== "object" ||
    owner === null ||
    !("pid" in owner) ||
    typeof owner.pid !== "number" ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0
  ) {
    throw new Error(`System test sandbox base image lock owner '${ownerFilePath}' is invalid.`);
  }

  return owner.pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ESRCH")) {
      return false;
    }

    if (isNodeErrorCode(error, "EPERM")) {
      return true;
    }

    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<void> {
  try {
    await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
      },
    });
  } catch (error) {
    const stderr = readErrorOutput(error, "stderr");
    const stdout = readErrorOutput(error, "stdout");
    const exitCode = readErrorExitCode(error);
    const output = formatCommandFailureOutput({ stdout, stderr });
    throw new Error(
      `Command failed: ${input.command} ${input.args.join(" ")}.${exitCode} Output:${output}`,
    );
  }
}

function formatCommandFailureOutput(input: { stdout: string; stderr: string }): string {
  const parts: string[] = [];

  if (input.stdout.length > 0) {
    parts.push(`\nstdout:\n${input.stdout}`);
  }

  if (input.stderr.length > 0) {
    parts.push(`\nstderr:\n${input.stderr}`);
  }

  if (parts.length === 0) {
    return " <no output>";
  }

  return parts.join("");
}

function readErrorOutput(error: unknown, key: "stderr" | "stdout"): string {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return "";
  }

  const value = Reflect.get(error, key);
  return typeof value === "string" ? value : "";
}

function readErrorExitCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }

  const value = error.code;
  if (typeof value !== "number") {
    return "";
  }

  return ` Exit code: ${String(value)}.`;
}
