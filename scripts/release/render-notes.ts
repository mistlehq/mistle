import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertValidReleaseVersion,
  normalizeReleaseTag,
  renderInitialReleaseNotes,
} from "./lib.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CliffConfigPath = join(RepositoryRootPath, "cliff.toml");

function ensureGitCliffAvailable(): void {
  try {
    execFileSync("git-cliff", ["--version"], {
      cwd: RepositoryRootPath,
      stdio: "ignore",
    });
  } catch {
    throw new Error("git-cliff is required on PATH. Run this inside the repo dev shell.");
  }
}

function renderGeneratedReleaseNotes(version: string): string {
  ensureGitCliffAvailable();
  return execFileSync(
    "git-cliff",
    [
      "--config",
      CliffConfigPath,
      "--unreleased",
      "--tag",
      normalizeReleaseTag(version),
      "--strip",
      "header",
    ],
    {
      cwd: RepositoryRootPath,
      encoding: "utf8",
    },
  );
}

export function renderReleaseNotes(version: string): string {
  assertValidReleaseVersion(version);

  if (version === "0.1.0") {
    return renderInitialReleaseNotes();
  }

  return renderGeneratedReleaseNotes(version);
}
