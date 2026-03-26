import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidReleaseVersion, normalizeReleaseTag } from "./lib.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VersionFilePath = join(RepositoryRootPath, "VERSION");

function readRepositoryVersion(): string {
  const version = readFileSync(VersionFilePath, "utf8").trim();
  assertValidReleaseVersion(version);
  return version;
}

function main(): void {
  const version = readRepositoryVersion();
  const tag = normalizeReleaseTag(version);

  execFileSync("git", ["tag", tag], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });

  process.stdout.write(`Created tag ${tag}.\n`);
}

main();
