import { describe, expect, it } from "vitest";

import { buildPatchCacheKey, parseSessionDiffPatch } from "./session-diff-panel-model.js";

const ValidPatch = [
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-page.tsx b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "index 1111111..2222222 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "@@ -1,1 +1,2 @@",
  ' import { Badge } from "@mistle/ui";',
  '+import { Button } from "@mistle/ui";',
].join("\n");

describe("buildPatchCacheKey", () => {
  it("uses the full patch content so same-length same-prefix diffs do not collide", () => {
    const sharedPrefix =
      "diff --git a/apps/dashboard/src/features/pages/session-workbench-page.tsx";
    const patchLeft = `${sharedPrefix}${"A".repeat(24)}`;
    const patchRight = `${sharedPrefix}${"B".repeat(24)}`;

    expect(patchLeft.length).toBe(patchRight.length);
    expect(patchLeft.slice(0, 64)).toBe(patchRight.slice(0, 64));
    expect(buildPatchCacheKey(patchLeft)).not.toBe(buildPatchCacheKey(patchRight));
  });
});

describe("parseSessionDiffPatch", () => {
  it("preserves exact patch text in the raw fallback path", () => {
    const patch = " \ndiff --git this is not a valid patch   \n";

    expect(parseSessionDiffPatch(patch)).toEqual({
      kind: "raw",
      patch,
      reason: "Failed to parse patch. Showing raw diff output.",
    });
  });

  it("returns raw fallback data for malformed non-empty patches", () => {
    expect(parseSessionDiffPatch("diff --git this is not a valid patch")).toEqual({
      kind: "raw",
      patch: "diff --git this is not a valid patch",
      reason: "Failed to parse patch. Showing raw diff output.",
    });
  });

  it("parses valid patches into file metadata", () => {
    const parsedPatch = parseSessionDiffPatch(ValidPatch);

    expect(parsedPatch.kind).toBe("parsed");
    if (parsedPatch.kind !== "parsed") {
      throw new Error("Expected parsed patch result.");
    }

    expect(parsedPatch.files).toHaveLength(1);
    expect(parsedPatch.files[0]?.name).toBe(
      "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    );
  });
});
