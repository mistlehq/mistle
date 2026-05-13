import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidReleaseVersion, releaseBranchName } from "./lib.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VersionFilePath = join(RepositoryRootPath, "VERSION");
const SandboxdCargoTomlPath = join(RepositoryRootPath, "packages/sandboxd/Cargo.toml");
const SandboxdCargoLockPath = join(RepositoryRootPath, "packages/sandboxd/Cargo.lock");
const SandboxdPackageName = "sandboxd";

function readRepositoryVersion(): string {
  const version = readFileSync(VersionFilePath, "utf8").trim();
  assertValidReleaseVersion(version);
  return version;
}

function updateCargoPackageVersion(filePath: string, packageName: string, version: string): void {
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split("\n");
  let inPackageBlock = false;
  let foundPackage = false;
  let updatedVersion = false;

  const updatedLines = lines.map((line) => {
    if (line === "[package]" || line === "[[package]]") {
      inPackageBlock = true;
      foundPackage = false;
      return line;
    }

    if (inPackageBlock && line.startsWith("[") && line !== "[package]" && line !== "[[package]]") {
      inPackageBlock = false;
      foundPackage = false;
      return line;
    }

    if (inPackageBlock && line === `name = "${packageName}"`) {
      foundPackage = true;
      return line;
    }

    if (inPackageBlock && foundPackage && line.startsWith("version = ")) {
      updatedVersion = true;
      return `version = "${version}"`;
    }

    return line;
  });

  if (!updatedVersion) {
    throw new Error(`Could not find package '${packageName}' version in ${filePath}.`);
  }

  writeFileSync(filePath, updatedLines.join("\n"), "utf8");
}

function updateSandboxdPackageVersion(version: string): void {
  updateCargoPackageVersion(SandboxdCargoTomlPath, SandboxdPackageName, version);
  updateCargoPackageVersion(SandboxdCargoLockPath, SandboxdPackageName, version);
}

function main(): void {
  const argumentsList = process.argv.slice(2);
  execFileSync("pnpm", ["release:prepare", ...argumentsList], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });

  const version = readRepositoryVersion();
  updateSandboxdPackageVersion(version);
  const branch = releaseBranchName(version);

  execFileSync("git", ["switch", "-c", branch], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });

  process.stdout.write(`Prepared ${version} on branch ${branch}.\n`);
}

main();
