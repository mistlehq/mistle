import { parsePatchFiles } from "@pierre/diffs";

const HunkHeaderPattern = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const ValidHunkLinePrefixes = new Set(["+", "-", " ", "\\"]);

function hasPatchHeader(diff: string): boolean {
  return diff.startsWith("diff --git ") || diff.startsWith("--- ") || diff.startsWith("+++ ");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function containsOnlyUnifiedDiffHunkLines(patch: string): boolean {
  const lines = patch.split("\n");
  let sawHunk = false;
  let inHunk = false;

  for (const [index, line] of lines.entries()) {
    if (line.length === 0 && index === lines.length - 1) {
      continue;
    }

    if (HunkHeaderPattern.test(line)) {
      sawHunk = true;
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    const firstChar = line[0];
    if (firstChar === undefined || !ValidHunkLinePrefixes.has(firstChar)) {
      return false;
    }
  }

  return sawHunk;
}

function hunkLineCountsMatchHeader(
  hunk: ReturnType<typeof parsePatchFiles>[number]["files"][number]["hunks"][number],
): boolean {
  let additions = 0;
  let deletions = 0;

  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      additions += content.lines;
      deletions += content.lines;
    } else {
      additions += content.additions;
      deletions += content.deletions;
    }
  }

  return additions === hunk.additionCount && deletions === hunk.deletionCount;
}

export function toDisplayPatch(path: string, diff: string): string {
  const trimmedDiff = diff.trim();
  if (trimmedDiff.length === 0) {
    throw new Error("File change diff cannot be empty.");
  }

  if (hasPatchHeader(trimmedDiff)) {
    return ensureTrailingNewline(trimmedDiff);
  }

  return ensureTrailingNewline(`--- ${path}\n+++ ${path}\n${trimmedDiff}`);
}

export function canDisplaySingleFilePatch(input: { diff: string; path: string }): boolean {
  let patch: string;
  try {
    patch = toDisplayPatch(input.path, input.diff);
  } catch {
    return false;
  }

  if (!containsOnlyUnifiedDiffHunkLines(patch)) {
    return false;
  }

  try {
    const parsedPatches = parsePatchFiles(patch, undefined, true);
    const parsedPatch = parsedPatches[0];
    const fileDiff = parsedPatch?.files[0];
    if (parsedPatch === undefined || fileDiff === undefined) {
      return false;
    }

    return (
      parsedPatches.length === 1 &&
      parsedPatch.files.length === 1 &&
      fileDiff !== undefined &&
      fileDiff.hunks.length > 0 &&
      fileDiff.hunks.every(hunkLineCountsMatchHeader)
    );
  } catch {
    return false;
  }
}
