import { describe, expect, it } from "vitest";

import { canDisplaySingleFilePatch, toDisplayPatch } from "./chat-file-change-diff.js";

describe("toDisplayPatch", () => {
  it("adds a unified patch header for hunk-only diffs", () => {
    expect(toDisplayPatch("/root/story.md", "@@ -1,1 +1,1 @@\n-old line\n+new line")).toBe(
      "--- /root/story.md\n+++ /root/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
    );
  });

  it("preserves full patch payloads", () => {
    expect(
      toDisplayPatch(
        "/root/story.md",
        "--- /root/story.md\n+++ /root/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n",
      ),
    ).toBe("--- /root/story.md\n+++ /root/story.md\n@@ -1,1 +1,1 @@\n-old line\n+new line\n");
  });

  it("accepts hunk-only single-file diffs for display", () => {
    expect(
      canDisplaySingleFilePatch({
        path: "/root/story.md",
        diff: "@@ -1,1 +1,1 @@\n-old line\n+new line",
      }),
    ).toBe(true);
  });

  it("rejects raw source text that is not a unified diff", () => {
    expect(
      canDisplaySingleFilePatch({
        path: "apps/data-plane-worker/openworkflow/shared/mark-sandbox-instance-starting.ts",
        diff: [
          "import {",
          "  SandboxInstanceStatuses,",
          '} from "@mistle/db/data-plane";',
          'import { and, eq, isNull, sql } from "drizzle-orm";',
          "",
          "export async function markSandboxInstanceStarting(",
          "): Promise<void> {",
          "}",
        ].join("\n"),
      }),
    ).toBe(false);
  });

  it("rejects malformed hunk bodies before the Pierre renderer sees them", () => {
    expect(
      canDisplaySingleFilePatch({
        path: "/root/story.md",
        diff: "@@ -1,1 +1,1 @@\nold line without a diff prefix",
      }),
    ).toBe(false);
  });

  it("rejects hunk bodies that do not match their header line counts", () => {
    expect(
      canDisplaySingleFilePatch({
        path: "/root/story.md",
        diff: "@@ -1,2 +1,2 @@\n-old\n+new",
      }),
    ).toBe(false);
  });
});
