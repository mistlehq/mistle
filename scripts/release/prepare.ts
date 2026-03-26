import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertValidReleaseVersion,
  compareReleaseVersions,
  formatReleaseVersion,
  normalizeReleaseTag,
  parseReleaseVersion,
  sameStableBase,
} from "./lib.js";

const RepositoryRootPath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VersionFilePath = join(RepositoryRootPath, "VERSION");

type ReleaseIntent =
  | {
      type: "channel";
      channel: "stable" | "alpha";
    }
  | {
      type: "override";
      version: string;
    };

type ConventionalCommitSummary = {
  hasFeature: boolean;
  hasBreakingChange: boolean;
};

function parseReleaseIntent(): ReleaseIntent {
  const argumentsList = process.argv.slice(2);

  if (argumentsList[0] === "--release-as") {
    const version = argumentsList[1];
    if (version === undefined || version.length === 0) {
      throw new Error("Usage: pnpm release:prepare --release-as <version>");
    }
    assertValidReleaseVersion(version);
    return { type: "override", version };
  }

  const channel = argumentsList[0];
  if (channel === "stable" || channel === "alpha") {
    return { type: "channel", channel };
  }

  throw new Error("Usage: pnpm release:prepare <stable|alpha> or --release-as <version>");
}

function updateVersionFile(version: string): void {
  writeFileSync(VersionFilePath, `${version}\n`, "utf8");
}

function listReleaseTags(): string[] {
  const output = execFileSync("git", ["tag", "--list", "v*"], {
    cwd: RepositoryRootPath,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listStableReleaseTags(): string[] {
  return listReleaseTags().filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
}

function getLatestStableReleaseVersion(): string | null {
  const versions = listStableReleaseTags()
    .map((tag) => tag.slice(1))
    .sort(compareReleaseVersions)
    .reverse();
  return versions[0] ?? null;
}

function readConventionalCommitSummary(sinceTag: string | null): ConventionalCommitSummary {
  const range = sinceTag === null ? "HEAD" : `${sinceTag}..HEAD`;
  const output = execFileSync("git", ["log", "--format=%s%n%b%x00", range], {
    cwd: RepositoryRootPath,
    encoding: "utf8",
  });

  const commits = output
    .split("\u0000")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (commits.length === 0) {
    throw new Error(
      sinceTag === null
        ? "Cannot infer a release version without commits in the repository."
        : `Cannot infer a release version because there are no commits since ${sinceTag}.`,
    );
  }

  return commits.reduce<ConventionalCommitSummary>(
    (summary, commit) => {
      const [subjectLine = "", ...bodyLines] = commit.split("\n");
      const body = bodyLines.join("\n");

      return {
        hasFeature: summary.hasFeature || /^feat(?:\(.+\))?!?:/.test(subjectLine),
        hasBreakingChange:
          summary.hasBreakingChange ||
          /^[a-z]+(?:\(.+\))?!:/.test(subjectLine) ||
          /BREAKING CHANGE:/m.test(body),
      };
    },
    { hasFeature: false, hasBreakingChange: false },
  );
}

function inferNextStableVersion(): string {
  const latestStableVersion = getLatestStableReleaseVersion();
  if (latestStableVersion === null) {
    return "0.1.0";
  }

  const summary = readConventionalCommitSummary(normalizeReleaseTag(latestStableVersion));
  const parsedVersion = parseReleaseVersion(latestStableVersion);

  if (summary.hasFeature || summary.hasBreakingChange) {
    return formatReleaseVersion({
      major: parsedVersion.major,
      minor: parsedVersion.minor + 1,
      patch: 0,
      alphaNumber: null,
    });
  }

  return formatReleaseVersion({
    major: parsedVersion.major,
    minor: parsedVersion.minor,
    patch: parsedVersion.patch + 1,
    alphaNumber: null,
  });
}

function inferReleaseVersion(intent: ReleaseIntent): string {
  if (intent.type === "override") {
    return intent.version;
  }

  const nextStableVersion = inferNextStableVersion();
  if (intent.channel === "stable") {
    return nextStableVersion;
  }

  const alphaVersions = listReleaseTags()
    .map((tag) => tag.slice(1))
    .filter((version) => version.includes("-alpha."))
    .filter((version) => sameStableBase(version, nextStableVersion))
    .sort(compareReleaseVersions);
  const latestAlphaVersion = alphaVersions.at(-1);

  if (latestAlphaVersion === undefined) {
    return `${nextStableVersion}-alpha.1`;
  }

  const parsedAlphaVersion = parseReleaseVersion(latestAlphaVersion);
  return formatReleaseVersion({
    major: parsedAlphaVersion.major,
    minor: parsedAlphaVersion.minor,
    patch: parsedAlphaVersion.patch,
    alphaNumber: (parsedAlphaVersion.alphaNumber ?? 0) + 1,
  });
}

function validateReleaseVersionDoesNotAlreadyExist(version: string): void {
  const releaseTag = normalizeReleaseTag(version);
  if (listReleaseTags().includes(releaseTag)) {
    throw new Error(`Release tag already exists: ${releaseTag}`);
  }
}

function regenerateOpenApiSpecs(): void {
  execFileSync("pnpm", ["--filter", "@mistle/control-plane-api", "openapi:generate"], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });
  execFileSync("pnpm", ["--filter", "@mistle/data-plane-api", "openapi:generate"], {
    cwd: RepositoryRootPath,
    stdio: "inherit",
  });
}

function main(): void {
  const intent = parseReleaseIntent();
  const version = inferReleaseVersion(intent);
  validateReleaseVersionDoesNotAlreadyExist(version);
  updateVersionFile(version);
  regenerateOpenApiSpecs();
}

main();
