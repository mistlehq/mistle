import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidReleaseVersion, releaseBranchName } from "./lib.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VersionFilePath = join(RepositoryRootPath, "VERSION");

function readRepositoryVersion(): string {
  const version = readFileSync(VersionFilePath, "utf8").trim();
  assertValidReleaseVersion(version);
  return version;
}

function main(): void {
  const argumentsList = process.argv.slice(2);
  execFileSync("pnpm", ["release:prepare", ...argumentsList], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });

  const version = readRepositoryVersion();
  const branch = releaseBranchName(version);

  execFileSync("git", ["switch", "-c", branch], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });

  process.stdout.write(`Prepared ${version} on branch ${branch}.\n`);
}

main();
