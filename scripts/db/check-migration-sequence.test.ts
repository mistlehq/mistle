import { describe, expect, it } from "vitest";

import { findMigrationSequenceFailures } from "./check-migration-sequence.ts";

describe("migration sequence validation", () => {
  it("accepts a branch migration that follows the base branch max index", () => {
    expect(
      findMigrationSequenceFailures({
        base: buildPlaneSnapshot({
          rootPath: "packages/db/migrations/control-plane",
          tags: ["0000_init", "0001_add-base-table"],
        }),
        baseLabel: "origin/main",
        current: buildPlaneSnapshot({
          rootPath: "packages/db/migrations/control-plane",
          tags: ["0000_init", "0001_add-base-table", "0002_add-branch-table"],
        }),
        plane: "control-plane",
      }),
    ).toEqual([]);
  });

  it("reports a branch migration that reuses a base branch index", () => {
    expect(
      findMigrationSequenceFailures({
        base: buildPlaneSnapshot({
          rootPath: "packages/db/migrations/control-plane",
          tags: ["0000_init", "0001_add-base-table"],
        }),
        baseLabel: "origin/main",
        current: buildPlaneSnapshot({
          rootPath: "packages/db/migrations/control-plane",
          tags: ["0000_init", "0001_add-branch-table"],
        }),
        plane: "control-plane",
      }),
    ).toContain(
      [
        "control-plane migration index 0001 conflicts with origin/main:",
        "current control-plane/0001_add-branch-table.sql,",
        "base control-plane/0001_add-base-table.sql.",
        "Regenerate the branch migration on top of the latest base migration.",
      ].join("\n"),
    );
  });

  it("reports current tree metadata drift before comparing with base", () => {
    expect(
      findMigrationSequenceFailures({
        base: buildPlaneSnapshot({
          rootPath: "packages/db/migrations/data-plane",
          tags: ["0000_init"],
        }),
        baseLabel: "origin/main",
        current: {
          journalEntries: [{ idx: 0, tag: "0000_different" }],
          rootPath: "packages/db/migrations/data-plane",
          snapshotIndexes: [],
          sqlMigrations: [
            {
              index: 0,
              indexText: "0000",
              relativePath: "data-plane/0000_init.sql",
              tag: "0000_init",
            },
          ],
        },
        plane: "data-plane",
      }),
    ).toEqual(
      expect.arrayContaining([
        "current data-plane/0000_init.sql conflicts with journal idx 0000: SQL tag 0000_init, journal tag 0000_different.",
        "current data-plane/0000_init.sql has no matching meta/0000_snapshot.json.",
      ]),
    );
  });
});

function buildPlaneSnapshot(input: {
  rootPath: string;
  tags: readonly string[];
}): Parameters<typeof findMigrationSequenceFailures>[0]["current"] {
  return {
    journalEntries: input.tags.map((tag) => {
      return { idx: parseIndex(tag), tag };
    }),
    rootPath: input.rootPath,
    snapshotIndexes: input.tags.map((tag) => tag.slice(0, 4)),
    sqlMigrations: input.tags.map((tag) => {
      return {
        index: parseIndex(tag),
        indexText: tag.slice(0, 4),
        relativePath: `${input.rootPath.split("/").at(-1)}/${tag}.sql`,
        tag,
      };
    }),
  };
}

function parseIndex(tag: string): number {
  return Number.parseInt(tag.slice(0, 4), 10);
}
