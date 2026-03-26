import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ReleaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta)\.(0|[1-9]\d*))?$/;
const VersionFileName = "VERSION";
const VersionCache = new Map<string, string>();

function readVersionFile(directoryPath: string): string | undefined {
  const versionFilePath = join(directoryPath, VersionFileName);
  if (!existsSync(versionFilePath)) {
    return undefined;
  }

  const version = readFileSync(versionFilePath, "utf8").trim();
  if (version.length === 0) {
    throw new Error(`Release version file is empty: ${versionFilePath}`);
  }
  if (!ReleaseVersionPattern.test(version)) {
    throw new Error(`Release version file contains an invalid version: ${versionFilePath}`);
  }

  return version;
}

function resolveVersionFileDirectory(startDirectoryPath: string): string {
  let directoryPath = startDirectoryPath;

  for (;;) {
    const version = readVersionFile(directoryPath);
    if (version !== undefined) {
      VersionCache.set(startDirectoryPath, version);
      return directoryPath;
    }

    const parentDirectoryPath = dirname(directoryPath);
    if (parentDirectoryPath === directoryPath) {
      throw new Error(
        `Could not locate ${VersionFileName} by walking up from ${startDirectoryPath}.`,
      );
    }

    directoryPath = parentDirectoryPath;
  }
}

export function readRepositoryVersion(fromImportMetaUrl: string): string {
  const startDirectoryPath = dirname(fileURLToPath(fromImportMetaUrl));
  const cachedVersion = VersionCache.get(startDirectoryPath);
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  const versionDirectoryPath = resolveVersionFileDirectory(startDirectoryPath);
  const version = readVersionFile(versionDirectoryPath);
  if (version === undefined) {
    throw new Error(`Resolved ${VersionFileName} directory without a version file.`);
  }

  VersionCache.set(startDirectoryPath, version);
  return version;
}
