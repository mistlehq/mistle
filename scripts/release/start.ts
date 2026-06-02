import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidReleaseVersion, normalizeReleaseTag, releaseBranchName } from "./lib.js";
import { updateMstlCargoLockFiles, updateMstlCargoTomlVersionFiles } from "./mstl-version.js";
import { renderReleaseNotes } from "./render-notes.js";
import {
  updateSandboxdCargoLockFile,
  updateSandboxdCargoTomlVersionFile,
} from "./sandboxd-version.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VersionFilePath = join(RepositoryRootPath, "VERSION");

function readRepositoryVersion(): string {
  const version = readFileSync(VersionFilePath, "utf8").trim();
  assertValidReleaseVersion(version);
  return version;
}

function execGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: RepositoryRootPath,
    encoding: "utf8",
  }).trim();
}

function ensureRequiredCommandAvailable(command: string): void {
  try {
    execFileSync(command, ["--version"], {
      cwd: RepositoryRootPath,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`${command} is required on PATH. Run this inside the repo dev shell.`);
  }
}

function ensureTrackedWorkingTreeClean(): void {
  const status = execGit(["status", "--porcelain=v1", "--untracked-files=no"]);
  if (status.length > 0) {
    throw new Error("Release start requires a clean tracked working tree.");
  }
}

function currentBranchName(): string {
  return execGit(["branch", "--show-current"]);
}

function ensureStartingFromMain(): void {
  const branch = currentBranchName();
  if (branch !== "main") {
    throw new Error(`Release start must run from main. Current branch: ${branch}`);
  }
}

function commitRelease(version: string): void {
  execFileSync("git", ["add", "--update"], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });
  execFileSync("git", ["commit", "--message", `chore(release): ${normalizeReleaseTag(version)}`], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });
}

function createReleasePullRequest(version: string, branch: string): void {
  const temporaryDirectoryPath = mkdtempSync(join(tmpdir(), "mistle-release-pr-"));
  const bodyPath = join(temporaryDirectoryPath, "body.md");

  try {
    writeFileSync(bodyPath, renderReleaseNotes(version), "utf8");
    execFileSync("git", ["push", "--set-upstream", "origin", branch], {
      cwd: RepositoryRootPath,
      stdio: "inherit",
    });
    execFileSync(
      "gh",
      [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        `chore(release): ${normalizeReleaseTag(version)}`,
        "--body-file",
        bodyPath,
      ],
      {
        cwd: RepositoryRootPath,
        stdio: "inherit",
      },
    );
  } finally {
    rmSync(temporaryDirectoryPath, { recursive: true, force: true });
  }
}

function main(): void {
  const argumentsList = process.argv.slice(2);
  ensureTrackedWorkingTreeClean();
  ensureStartingFromMain();
  ensureRequiredCommandAvailable("git-cliff");
  ensureRequiredCommandAvailable("gh");
  ensureRequiredCommandAvailable("cargo");

  execFileSync("pnpm", ["release:prepare", ...argumentsList], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });

  const version = readRepositoryVersion();
  const branch = releaseBranchName(version);
  updateSandboxdCargoTomlVersionFile(RepositoryRootPath, version);
  updateSandboxdCargoLockFile(RepositoryRootPath, version);
  updateMstlCargoTomlVersionFiles(RepositoryRootPath, version);
  updateMstlCargoLockFiles(RepositoryRootPath, version);

  execFileSync("git", ["switch", "-c", branch], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });
  commitRelease(version);
  createReleasePullRequest(version, branch);

  process.stdout.write(`Opened release PR for ${version} from ${branch}.\n`);
}

main();
