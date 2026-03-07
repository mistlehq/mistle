import { describe, expect, it } from "vitest";

import { toDisplayPatch } from "./chat-file-change-diff.js";

describe("toDisplayPatch", () => {
  it("adds a unified patch header for hunk-only diffs", () => {
    expect(toDisplayPatch("/workspace/story.md", "@@ -1,1 +1,1 @@\n-old line\n+new line")).toBe(
      "--- /workspace/story.md\n+++ /workspace/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
    );
  });

  it("preserves full patch payloads", () => {
    expect(
      toDisplayPatch(
        "/workspace/story.md",
        "--- /workspace/story.md\n+++ /workspace/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
      ),
    ).toBe(
      "--- /workspace/story.md\n+++ /workspace/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
    );
  });
});
