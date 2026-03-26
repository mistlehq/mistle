import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidReleaseVersion } from "./lib.js";
import { renderReleaseNotes } from "./render-notes.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VersionFilePath = join(RepositoryRootPath, "VERSION");
const TemporaryDirectoryPath = join(RepositoryRootPath, ".tmp");
const ReleaseNotesPath = join(TemporaryDirectoryPath, "release-notes.md");

function readRepositoryVersion(): string {
  const version = readFileSync(VersionFilePath, "utf8").trim();
  assertValidReleaseVersion(version);
  return version;
}

function main(): void {
  const version = readRepositoryVersion();
  mkdirSync(TemporaryDirectoryPath, { recursive: true });
  writeFileSync(ReleaseNotesPath, renderReleaseNotes(version), "utf8");
  process.stdout.write(`Wrote ${ReleaseNotesPath}.\n`);
}

main();
