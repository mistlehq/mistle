import { SandboxProvider, type SandboxImageHandle } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { selectUnusedSandboxImageDeletionCandidates } from "./prune-unused-sandbox-images.js";

const CutoffMs = Date.parse("2026-07-01T12:00:00.000Z");

describe("selectUnusedSandboxImageDeletionCandidates", () => {
  it("selects only old unreferenced sandbox images", () => {
    const candidates = selectUnusedSandboxImageDeletionCandidates({
      images: [
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "old-unreferenced",
          createdAt: "2026-07-01T11:59:59.999Z",
        }),
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "referenced",
          createdAt: "2026-06-30T12:00:00.000Z",
        }),
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "recent",
          createdAt: "2026-07-01T12:00:00.000Z",
        }),
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "unknown-created-at",
          createdAt: "not-a-date",
        }),
      ],
      referencedImages: new Set([`${SandboxProvider.TENSORLAKE}\0referenced`]),
      cutoffMs: CutoffMs,
    });

    expect(candidates.map((candidate) => candidate.imageId)).toEqual(["old-unreferenced"]);
  });

  it("treats provider and image id as the reference identity", () => {
    const candidates = selectUnusedSandboxImageDeletionCandidates({
      images: [
        createImage({
          provider: SandboxProvider.DOCKER,
          imageId: "shared-id",
          createdAt: "2026-06-30T12:00:00.000Z",
        }),
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "shared-id",
          createdAt: "2026-06-30T12:00:00.000Z",
        }),
      ],
      referencedImages: new Set([`${SandboxProvider.TENSORLAKE}\0shared-id`]),
      cutoffMs: CutoffMs,
    });

    expect(candidates).toEqual([
      createImage({
        provider: SandboxProvider.DOCKER,
        imageId: "shared-id",
        createdAt: "2026-06-30T12:00:00.000Z",
      }),
    ]);
  });

  it("selects the oldest images first", () => {
    const candidates = selectUnusedSandboxImageDeletionCandidates({
      images: [
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "newer",
          createdAt: "2026-06-30T12:00:00.000Z",
        }),
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "oldest",
          createdAt: "2026-06-29T12:00:00.000Z",
        }),
        createImage({
          provider: SandboxProvider.TENSORLAKE,
          imageId: "middle",
          createdAt: "2026-06-30T00:00:00.000Z",
        }),
      ],
      referencedImages: new Set(),
      cutoffMs: CutoffMs,
    });

    expect(candidates.map((candidate) => candidate.imageId)).toEqual(["oldest", "middle", "newer"]);
  });
});

function createImage(input: {
  provider: SandboxImageHandle["provider"];
  imageId: string;
  createdAt: string;
}): SandboxImageHandle {
  return {
    provider: input.provider,
    imageId: input.imageId,
    createdAt: input.createdAt,
  };
}
