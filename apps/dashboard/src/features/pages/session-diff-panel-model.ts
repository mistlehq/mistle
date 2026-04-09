import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";

type ParsedSessionDiff =
  | {
      files: readonly FileDiffMetadata[];
      kind: "parsed";
    }
  | {
      kind: "raw";
      patch: string;
      reason: string;
    };

function buildPatchCacheKey(patch: string): string {
  return `session-diff-panel:${patch}`;
}

function parseSessionDiffPatch(patch: string): ParsedSessionDiff {
  if (patch.length === 0) {
    return {
      files: [],
      kind: "parsed",
    };
  }

  try {
    const parsedPatches = parsePatchFiles(patch, buildPatchCacheKey(patch), true);
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);

    if (files.length === 0) {
      return {
        kind: "raw",
        patch,
        reason: "Failed to parse patch. Showing raw diff output.",
      };
    }

    return {
      files,
      kind: "parsed",
    };
  } catch {
    return {
      kind: "raw",
      patch,
      reason: "Failed to parse patch. Showing raw diff output.",
    };
  }
}

export { buildPatchCacheKey, parseSessionDiffPatch };
export type { ParsedSessionDiff };
