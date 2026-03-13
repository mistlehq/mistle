import { describe, expect, it } from "vitest";

import { toDisplayPatch } from "./chat-file-change-diff.js";

describe("toDisplayPatch", () => {
  it("adds a unified patch header for hunk-only diffs", () => {
    expect(toDisplayPatch("/home/sandbox/story.md", "@@ -1,1 +1,1 @@\n-old line\n+new line")).toBe(
      "--- /home/sandbox/story.md\n+++ /home/sandbox/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
    );
  });

  it("preserves full patch payloads", () => {
    expect(
      toDisplayPatch(
        "/home/sandbox/story.md",
        "--- /home/sandbox/story.md\n+++ /home/sandbox/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
      ),
    ).toBe(
      "--- /home/sandbox/story.md\n+++ /home/sandbox/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
    );
  });
});
