export const ReleaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.(0|[1-9]\d*))?$/;

export type ParsedReleaseVersion = {
  major: number;
  minor: number;
  patch: number;
  alphaNumber: number | null;
};

export function assertValidReleaseVersion(version: string): void {
  if (!ReleaseVersionPattern.test(version)) {
    throw new Error(`Release version must match x.y.z or x.y.z-alpha.n. Received: ${version}`);
  }
}

export function normalizeReleaseTag(version: string): string {
  assertValidReleaseVersion(version);
  return `v${version}`;
}

export function releaseBranchName(version: string): string {
  return `release/${normalizeReleaseTag(version)}`;
}

export function isStableReleaseVersion(version: string): boolean {
  assertValidReleaseVersion(version);
  return !version.includes("-");
}

export function parseReleaseVersion(version: string): ParsedReleaseVersion {
  assertValidReleaseVersion(version);
  const [stablePart, alphaPart] = version.split("-alpha.");
  if (stablePart === undefined) {
    throw new Error(`Failed to parse release version: ${version}`);
  }

  const segments = stablePart.split(".");
  const [majorSegment, minorSegment, patchSegment] = segments;
  if (majorSegment === undefined || minorSegment === undefined || patchSegment === undefined) {
    throw new Error(`Failed to parse release version: ${version}`);
  }

  return {
    major: Number.parseInt(majorSegment, 10),
    minor: Number.parseInt(minorSegment, 10),
    patch: Number.parseInt(patchSegment, 10),
    alphaNumber: alphaPart === undefined ? null : Number.parseInt(alphaPart, 10),
  };
}

export function formatReleaseVersion(version: ParsedReleaseVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  if (version.alphaNumber === null) {
    return base;
  }

  return `${base}-alpha.${version.alphaNumber}`;
}

export function compareReleaseVersions(left: string, right: string): number {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);

  if (parsedLeft.major < parsedRight.major) {
    return -1;
  }
  if (parsedLeft.major > parsedRight.major) {
    return 1;
  }
  if (parsedLeft.minor < parsedRight.minor) {
    return -1;
  }
  if (parsedLeft.minor > parsedRight.minor) {
    return 1;
  }
  if (parsedLeft.patch < parsedRight.patch) {
    return -1;
  }
  if (parsedLeft.patch > parsedRight.patch) {
    return 1;
  }

  if (parsedLeft.alphaNumber === null && parsedRight.alphaNumber === null) {
    return 0;
  }
  if (parsedLeft.alphaNumber === null) {
    return 1;
  }
  if (parsedRight.alphaNumber === null) {
    return -1;
  }
  if (parsedLeft.alphaNumber < parsedRight.alphaNumber) {
    return -1;
  }
  if (parsedLeft.alphaNumber > parsedRight.alphaNumber) {
    return 1;
  }
  return 0;
}

export function sameStableBase(left: string, right: string): boolean {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);

  return (
    parsedLeft.major === parsedRight.major &&
    parsedLeft.minor === parsedRight.minor &&
    parsedLeft.patch === parsedRight.patch
  );
}

export function renderInitialReleaseNotes(): string {
  return "Initial public release.\n";
}
