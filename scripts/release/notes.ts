import { assertValidReleaseVersion } from "./lib.js";
import { renderReleaseNotes } from "./render-notes.js";

function readVersion(): string {
  const version = process.argv[2];
  if (version === undefined || version.length === 0) {
    throw new Error("Usage: pnpm release:notes <version>");
  }
  assertValidReleaseVersion(version);
  return version;
}

function main(): void {
  const version = readVersion();
  process.stdout.write(renderReleaseNotes(version));
}

main();
