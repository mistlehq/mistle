import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VersionConstPattern = /const \(\n\tVersion = "([^"]+)"/;

export function updateMstlGoVersion(source: string, version: string): string {
  if (VersionConstPattern.test(source) === false) {
    throw new Error("packages/mstl-cli/internal/cli/cli.go is missing the Version const");
  }

  return source.replace(VersionConstPattern, `const (\n\tVersion = "${version}"`);
}

export function updateMstlGoVersionFile(repositoryRootPath: string, version: string): void {
  const cliSourcePath = join(
    repositoryRootPath,
    "packages",
    "mstl-cli",
    "internal",
    "cli",
    "cli.go",
  );
  writeFileSync(
    cliSourcePath,
    updateMstlGoVersion(readFileSync(cliSourcePath, "utf8"), version),
    "utf8",
  );
}
