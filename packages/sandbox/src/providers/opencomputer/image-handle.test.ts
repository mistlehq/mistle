import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider } from "../../types.js";
import { createOpenComputerBaseImage, createOpenComputerImageManifest } from "./client.js";
import {
  createOpenComputerBaseImageName,
  createOpenComputerCheckpointImageHandle,
  createOpenComputerDeferredImageHandle,
  createOpenComputerSnapshotImageHandle,
  createOpenComputerTemplateImageHandle,
  parseOpenComputerImageHandle,
  resolveOpenComputerStartImage,
} from "./image-handle.js";

describe("OpenComputer image handles", () => {
  it("encodes and parses supported image handle kinds", () => {
    const manifest = createOpenComputerBaseImage({
      source: { kind: "image", imageId: "ghcr.io/mistlehq/base:latest" },
    });

    expect(
      parseOpenComputerImageHandle(
        createOpenComputerDeferredImageHandle({
          imageName: "base",
          manifest: createOpenComputerImageManifest(manifest),
        }),
      ),
    ).toEqual({
      kind: "image",
      id: "base",
      manifest: createOpenComputerImageManifest(manifest),
    });
    expect(parseOpenComputerImageHandle(createOpenComputerSnapshotImageHandle("base"))).toEqual({
      kind: "snapshot",
      id: "base",
    });
    expect(parseOpenComputerImageHandle(createOpenComputerCheckpointImageHandle("cp-1"))).toEqual({
      kind: "checkpoint",
      id: "cp-1",
    });
    expect(parseOpenComputerImageHandle(createOpenComputerTemplateImageHandle("base"))).toEqual({
      kind: "template",
      id: "base",
    });
  });

  it("rejects handles for other providers and unknown prefixes", () => {
    expect(() =>
      parseOpenComputerImageHandle({
        provider: SandboxProvider.TENSORLAKE,
        imageId: "snapshot:base",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(SandboxConfigurationError);

    expect(() =>
      parseOpenComputerImageHandle({
        provider: SandboxProvider.OPENCOMPUTER,
        imageId: "ghcr.io/mistlehq/sandbox-base:latest",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("resolves OCI base image references to deterministic deferred image starts", () => {
    const baseImageRef = "ghcr.io/mistlehq/sandbox-base:latest";
    const manifest = createOpenComputerImageManifest(
      createOpenComputerBaseImage({
        source: { kind: "image", imageId: baseImageRef },
      }),
    );

    expect(
      resolveOpenComputerStartImage({
        provider: SandboxProvider.OPENCOMPUTER,
        imageId: baseImageRef,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "image",
      id: createOpenComputerBaseImageName({ baseImageRef, manifest }),
      manifest,
    });
  });

  it("resolves provider-prefixed image handles through the strict parser", () => {
    expect(resolveOpenComputerStartImage(createOpenComputerSnapshotImageHandle("base"))).toEqual({
      kind: "snapshot",
      id: "base",
    });
  });

  it("creates deterministic base image names from image references", () => {
    expect(
      createOpenComputerBaseImageName({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base@sha256:".concat("b".repeat(64)),
      }),
    ).toBe(`mistle-${"b".repeat(24)}`);
    expect(
      createOpenComputerBaseImageName({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:latest",
      }),
    ).toBe(
      createOpenComputerBaseImageName({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:latest",
      }),
    );
  });

  it("includes manifest content in generated base image names", () => {
    const baseImageRef = "ghcr.io/mistlehq/sandbox-base:latest";
    const firstManifest = createOpenComputerImageManifest(
      createOpenComputerBaseImage({
        source: { kind: "image", imageId: baseImageRef },
      }),
    );
    const secondManifest = createOpenComputerImageManifest(
      createOpenComputerBaseImage({
        source: { kind: "image", imageId: "ghcr.io/mistlehq/sandbox-base:other" },
      }),
    );

    expect(createOpenComputerBaseImageName({ baseImageRef, manifest: firstManifest })).not.toBe(
      createOpenComputerBaseImageName({ baseImageRef, manifest: secondManifest }),
    );
  });

  it("rejects deferred image handles that do not carry the source manifest", () => {
    expect(() =>
      parseOpenComputerImageHandle({
        provider: SandboxProvider.OPENCOMPUTER,
        imageId: "image:base",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow("manifest");
  });
});
