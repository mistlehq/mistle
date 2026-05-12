import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ReleaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.(0|[1-9]\d*))?$/u;

export function readServiceReleaseVersion(input?: { startDirectory?: string }): string {
  const startDirectory = input?.startDirectory ?? process.cwd();
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidatePath = join(currentDirectory, "VERSION");
    if (existsSync(candidatePath)) {
      const version = readFileSync(candidatePath, "utf8").trim();
      if (!ReleaseVersionPattern.test(version)) {
        throw new Error(
          `Service release version file '${candidatePath}' must match x.y.z or x.y.z-alpha.n. Received: ${version}`,
        );
      }
      return version;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(`Could not find service release VERSION file from '${startDirectory}'.`);
    }

    currentDirectory = parentDirectory;
  }
}
