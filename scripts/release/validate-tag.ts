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

function readReleaseTag(): string {
  const tag = process.argv[2] ?? process.env["GITHUB_REF_NAME"];
  if (tag === undefined || tag.length === 0) {
    throw new Error("Release tag must be provided as an argument or via GITHUB_REF_NAME.");
  }
  return tag;
}

function main(): void {
  const version = readRepositoryVersion();
  const expectedTag = normalizeReleaseTag(version);
  const tag = readReleaseTag();

  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match VERSION ${expectedTag}.`);
  }

  process.stdout.write(`Validated release tag ${tag} against VERSION ${version}.\n`);
}

main();
