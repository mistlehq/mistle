import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VersionConstPattern = /const \(\n\tVersion\s+= "([^"]+)"/;

export function updateSandboxdGoVersion(source: string, version: string): string {
  if (VersionConstPattern.test(source) === false) {
    throw new Error("packages/sandboxd/internal/sandboxd/sandboxd.go is missing the Version const");
  }

  return source.replace(VersionConstPattern, `const (\n\tVersion                  = "${version}"`);
}

export function updateSandboxdGoVersionFile(repositoryRootPath: string, version: string): void {
  const sandboxdSourcePath = join(
    repositoryRootPath,
    "packages",
    "sandboxd",
    "internal",
    "sandboxd",
    "sandboxd.go",
  );
  writeFileSync(
    sandboxdSourcePath,
    updateSandboxdGoVersion(readFileSync(sandboxdSourcePath, "utf8"), version),
    "utf8",
  );
}
